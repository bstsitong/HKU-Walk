from rest_framework.views import exception_handler

def handle_exception(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        response["Cache-Control"] = "no-store"
    return response
