FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt \
    && groupadd --gid 10001 hku \
    && useradd --uid 10001 --gid hku --no-create-home hku \
    && mkdir -p /data /backups && chown hku:hku /data /backups
COPY --chown=hku:hku server /app/server
COPY --chown=hku:hku deploy/entrypoint.py /app/deploy/entrypoint.py
USER hku
EXPOSE 8000
ENTRYPOINT ["python", "/app/deploy/entrypoint.py"]
