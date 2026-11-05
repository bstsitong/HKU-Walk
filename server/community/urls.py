from django.urls import path
from . import views

urlpatterns = [
    path("accounts/register/", views.Register.as_view()),
    path("accounts/login/", views.Login.as_view()),
    path("accounts/me/", views.Me.as_view()),
    path("accounts/logout/", views.Logout.as_view()),
    path("accounts/change-password/", views.ChangePassword.as_view()),
    path("accounts/recovery-code/", views.RotateRecoveryCode.as_view()),
    path("accounts/recover/", views.RecoverAccount.as_view()),
    path("submissions/", views.Submissions.as_view()),
    path("submissions/<uuid:pk>/", views.SubmissionDetail.as_view()),
    path("submissions/<uuid:pk>/edits/", views.PublishedEdit.as_view()),
    path("images/<uuid:pk>/", views.SubmissionImage.as_view(), name="submission-image"),
]
