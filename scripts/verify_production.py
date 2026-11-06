"""Isolated production-mode HTTP + backup/restore smoke check (SQLite storage).

This checks the WSGI application and proxy configuration on Windows. It does not
claim to test Docker, a public TLS certificate, PostgreSQL, or a physical phone.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def manage(env, *args):
    result = subprocess.run([sys.executable, str(ROOT / 'server/manage.py'), *args], cwd=ROOT,
        env=env, capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(f"Django command failed ({args[0]}):\n{result.stdout[-1800:]}\n{result.stderr[-1800:]}")
    return result.stdout

def http(base, path, data=None, token=None, content_type='application/json', expected=200):
    headers = {'Host': 'hku.example', 'X-Forwarded-Proto': 'https', 'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if data is not None:
        headers['Content-Type'] = content_type
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
    request = urllib.request.Request(base + path, data=data, headers=headers)
    try:
        response = opener.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = response.read()
        assert response.status == expected, (path, response.status, payload[:300])
        return payload, dict(response.headers)

def review(env, identifier):
    manage(env, 'shell', '-c', "from django.contrib.auth import get_user_model; from community.services import review_submission; from community.models import Submission; "
        "reviewer, _ = get_user_model().objects.get_or_create(username='smoke_reviewer',defaults={'is_staff': True}); "
        f"item=Submission.objects.get(pk={identifier!r}); review_submission(item.pk,item.revision,'approved','Smoke verified',reviewer)")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--storage', choices=['local', 'database'], default='local')
    options = parser.parse_args()
    evidence = []
    with tempfile.TemporaryDirectory(prefix='hku-production-') as directory:
        root = Path(directory)
        env = os.environ.copy()
        for key in ('DATABASE_URL', 'DATABASE_URL_FILE', 'POSTGRES_PASSWORD_FILE', 'DJANGO_SECRET_KEY_FILE', 'DJANGO_ADMIN_PASSWORD_FILE', 'DJANGO_DB_PATH'):
            env.pop(key, None)
        env.update(DJANGO_DEBUG='0', DJANGO_ALLOW_SQLITE='1', DJANGO_SECRET_KEY=secrets.token_urlsafe(64),
            DJANGO_DATA_DIR=str(root / 'source'), DJANGO_PUBLIC_ORIGIN='https://hku.example',
            DJANGO_ALLOWED_HOSTS='hku.example,127.0.0.1,localhost', DJANGO_CSRF_TRUSTED_ORIGINS='https://hku.example',
            DJANGO_TRUST_PROXY='1', PYTHONPATH=str(ROOT / 'server'), PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
        env.update(DJANGO_STORAGE=options.storage, DJANGO_DB_SCHEMA='', DJANGO_MAINTENANCE='0', RENDER='')
        for command in [('migrate', '--noinput'), ('createcachetable',), ('seed_guide',), ('collectstatic', '--noinput'), ('check', '--deploy', '--fail-level', 'WARNING')]:
            manage(env, *command)
        evidence.append('Production settings and collectstatic passed Django deployment checks')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        with (root / 'wsgi.log').open('wb') as log:
            process = subprocess.Popen([sys.executable, '-m', 'waitress', f'--listen=127.0.0.1:{port}',
                '--trusted-proxy=127.0.0.1', '--trusted-proxy-headers=x-forwarded-proto', 'config.wsgi:application'],
                cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                for _ in range(40):
                    try:
                        http(base, '/api/health/')
                        break
                    except (OSError, AssertionError):
                        if process.poll() is not None:
                            raise RuntimeError('The WSGI test server stopped')
                        time.sleep(0.2)
                else:
                    raise RuntimeError('The WSGI test server did not start')
                css, _ = http(base, '/static/admin/css/base.css')
                assert b'body' in css
                login_html, headers = http(base, '/admin/login/')
                assert b'csrfmiddlewaretoken' in login_html and 'Strict-Transport-Security' in headers
                evidence.append('Admin HTML and static CSS served behind the trusted HTTPS proxy header')
                original_password = secrets.token_urlsafe(20)
                result = json.loads(http(base, '/api/accounts/register/', {'username': 'smoke_student', 'password': original_password}, expected=201)[0])
                old_token = result['token']
                password = secrets.token_urlsafe(20)
                recovered = json.loads(http(base, '/api/accounts/recover/', {'recovery_code': result['recoveryCode'], 'new_password': password})[0])
                token = recovered['token']
                recovery_digest = hashlib.sha256(recovered['recoveryCode'].replace('-', '').encode()).hexdigest()
                http(base, '/api/accounts/me/', token=old_token, expected=401)
                evidence.append('Account recovery rotated its code and invalidated the old session over HTTP')
                image = io.BytesIO()
                Image.new('RGB', (120, 80), '#184d3e').save(image, 'PNG')
                boundary = secrets.token_hex(16)
                values = {'kind': 'food', 'title': 'Smoke original content', 'body': 'A generated test record for the production smoke check.', 'request_key': secrets.token_hex(12)}
                parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode() for key, value in values.items()]
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + image.getvalue() + b'\r\n')
                parts.append(f'--{boundary}--\r\n'.encode())
                posted = json.loads(http(base, '/api/submissions/', b''.join(parts), token, f'multipart/form-data; boundary={boundary}', 201)[0])['submission']
                http(base, f"/api/images/{posted['id']}/", expected=404)
                review(env, posted['id'])
                source = json.loads(http(base, f"/api/submissions/{posted['id']}/", token=token)[0])['submission']
                values.update(title='Smoke edited content', request_key=secrets.token_hex(12), base_version=source['publishedContent']['version'])
                edited = json.loads(http(base, f"/api/submissions/{posted['id']}/edits/", values, token, expected=201)[0])['submission']
                guide = http(base, '/api/guide/')[0]
                assert b'Smoke original content' in guide and b'Smoke edited content' not in guide
                review(env, edited['id'])
                assert b'Smoke edited content' in http(base, '/api/guide/')[0]
                photo, photo_headers = http(base, f"/api/images/{edited['id']}/")
                assert photo_headers['Content-Type'] == 'image/jpeg' and Image.open(io.BytesIO(photo)).format == 'JPEG'
                http(base, f"/api/images/{posted['id']}/", expected=404)
                evidence.append('Uploaded image remained private, then an approved edit replaced the public version and image URL')
                place_values = {'kind': 'new_place', 'title': 'Smoke study entrance', 'body': 'A generated place used only in the isolated verification database.',
                    'request_key': secrets.token_hex(12), 'map_data': {'category': 'study', 'x': 120, 'y': 280, 'english': 'Smoke entrance'}}
                place_submission = json.loads(http(base, '/api/submissions/', place_values, token, expected=201)[0])['submission']
                assert not json.loads(http(base, '/api/campus/')[0])['places']
                review(env, place_submission['id'])
                place = json.loads(http(base, '/api/campus/')[0])['places'][0]
                route_values = {'kind': 'new_route', 'title': 'Smoke walking route', 'body': 'An illustrated route used only for the isolated production verification.',
                    'request_key': secrets.token_hex(12), 'map_data': json.dumps({'originId': 'gate', 'destinationId': place['id'], 'steps': [
                        {'title': 'Start at the campus entrance', 'body': 'Identify the entrance using this sample image.'},
                        {'title': 'Arrive at the study entrance', 'body': 'Use the second sample image to identify the destination.'}]})}
                boundary = secrets.token_hex(16)
                parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode() for key,value in route_values.items()]
                for index in range(2):
                    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="step_image_{index}"; filename="step.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + image.getvalue() + b'\r\n')
                parts.append(f'--{boundary}--\r\n'.encode())
                route_submission = json.loads(http(base, '/api/submissions/', b''.join(parts), token, f'multipart/form-data; boundary={boundary}', 201)[0])['submission']
                from urllib.parse import urlsplit
                first_step = urlsplit(route_submission['mapData']['steps'][0]['imageUrl']).path
                http(base, first_step, expected=404)
                http(base, first_step, token=token)
                review(env, route_submission['id'])
                campus = json.loads(http(base, '/api/campus/')[0])
                assert len(campus['routes']) == 1 and len(campus['routes'][0]['steps']) == 2
                http(base, first_step)
                evidence.append('New places and illustrated routes became searchable public catalog data only after approval; step photos respected review permissions')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
        backup = root / 'backup.zip'
        manage(env, 'backup_project', '--output', str(backup))
        with zipfile.ZipFile(backup) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            for name, digest in manifest['files'].items():
                assert hashlib.sha256(archive.read(name)).hexdigest() == digest
        restored_env = {**env, 'DJANGO_DATA_DIR': str(root / 'restored')}
        manage(restored_env, 'migrate', '--noinput')
        manage(restored_env, 'restore_project', str(backup))
        manage(restored_env, 'shell', '-c', "from django.contrib.auth import get_user_model; from community.models import MobileSession,RecoveryCredential,Submission; from guide.models import GuideEntry; "
            "u=get_user_model().objects.get(username='smoke_student'); "
            f"assert u.check_password({password!r}); assert u.recovery_credential.token_hash=={recovery_digest!r}; "
            "assert not MobileSession.objects.exists(); assert Submission.objects.count()==4; "
            "e=GuideEntry.objects.get(title='Smoke edited content'); assert e.current_submission.image.storage.exists(e.current_submission.image.name); "
            "from community.models import SubmissionStepImage; assert SubmissionStepImage.objects.count()==2; "
            "assert all(photo.image.storage.exists(photo.image.name) for photo in SubmissionStepImage.objects.all()); "
            "assert len(GuideEntry.objects.get(title='Smoke walking route').map_data['steps'])==2")
        evidence.append('Backup hashes and restore into a separate empty database passed, including recovery credential, circular version links and uploaded image')
    output = ROOT / '.local' / ('production-verification' + ('-database-media' if options.storage == 'database' else '') + '.json')
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps({'storageTested': 'SQLite in isolated production-mode WSGI process; media=' + options.storage, 'checks': evidence,
        'notTested': ['Docker runtime', 'PostgreSQL server', 'public HTTPS certificate', 'physical Android or iPhone']}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('\n'.join('PASS: ' + step for step in evidence))

if __name__ == '__main__':
    main()
