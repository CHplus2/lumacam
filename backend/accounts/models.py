from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        STUDENT = 'student', 'Student'
        ADMIN = 'admin', 'Administrator'

    # Optional so signing up stays quick; NULL (not '') keeps the unique check working.
    email = models.EmailField(unique=True, null=True, blank=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.STUDENT)

    def save(self, *args, **kwargs):
        # create_user() turns a missing email into ''; store NULL so many accounts can skip it.
        if not self.email:
            self.email = None
        if self.is_superuser:
            self.role = self.Role.ADMIN
        super().save(*args, **kwargs)

    @property
    def display_name(self):
        """Name shown as the publisher on posts."""
        return (self.first_name or self.username).strip()

    @property
    def is_admin_role(self):
        return self.role == self.Role.ADMIN

    def __str__(self):
        return self.username
