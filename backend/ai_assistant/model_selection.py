"""Authorize legacy AI entry points before using shared model credentials."""

from django.contrib.auth import get_user_model
from rest_framework.exceptions import PermissionDenied

from accounts.services import is_user_readonly
from .model_profiles import resolve_model_profile


def selected_model_config(user, data, *, permissions=()):
    if not data.get("model_profile_id"):
        return {}, None

    actor_pk = getattr(user, "pk", None)

    def check_actor():
        actor = get_user_model().objects.filter(pk=actor_pk, is_active=True).first()
        if actor is None or is_user_readonly(actor) or not all(actor.has_perm(perm) for perm in permissions):
            raise PermissionDenied("You do not have permission to use AI for this resource.")
        return actor

    actor = check_actor()
    overrides, _metadata, check_profile = resolve_model_profile(actor, data["model_profile_id"])

    def guard():
        check_actor()
        check_profile()

    return overrides, guard
