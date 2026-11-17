from django.urls import path
from . import inbox, personal_records, views

urlpatterns = [
    path("accounts/register/", views.Register.as_view()),
    path("accounts/login/", views.Login.as_view()),
    path("accounts/me/", views.Me.as_view()),
    path("accounts/me/cover/", views.ProfileCoverSettings.as_view()),
    path("accounts/me/records/", personal_records.AccountRecords.as_view()),
    path("accounts/privacy/", views.PrivacySettings.as_view()),
    path("profiles/<uuid:public_id>/", views.PublicProfile.as_view()),
    path("avatars/<slug:key>/", views.ProfileAvatar.as_view(), name="profile-avatar"),
    path("accounts/logout/", views.Logout.as_view()),
    path("accounts/change-password/", views.ChangePassword.as_view()),
    path("accounts/recovery-code/", views.RotateRecoveryCode.as_view()),
    path("accounts/recover/", views.RecoverAccount.as_view()),
    path("inbox/", inbox.Inbox.as_view()),
    path("inbox/<int:pk>/read/", inbox.MarkInboxRead.as_view()),
    path("submissions/", views.Submissions.as_view()),
    path("submissions/<uuid:pk>/", views.SubmissionDetail.as_view()),
    path("submissions/<uuid:pk>/edits/", views.PublishedEdit.as_view()),
    path("images/<uuid:pk>/", views.SubmissionImage.as_view(), name="submission-image"),
    path("images/steps/<uuid:pk>/", views.SubmissionStepImageView.as_view(), name="submission-step-image"),
    path("images/body/<uuid:pk>/", views.SubmissionBodyImageView.as_view(), name="submission-body-image"),
    path("images/profile-cover/<slug:key>/", views.ProfileCoverImage.as_view(), name="profile-cover"),
]
