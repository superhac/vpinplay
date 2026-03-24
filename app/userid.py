import re


def normalize_user_id(user_id: str) -> str:
    return user_id.strip().lower()


def user_id_filter(user_id: str) -> dict:
    normalized = normalize_user_id(user_id)
    return {
        "$or": [
            {"userIdNormalized": normalized},
            {"userId": {"$regex": f"^{re.escape(normalized)}$", "$options": "i"}},
        ]
    }


def and_user_id_filter(user_id: str, extra: dict) -> dict:
    return {"$and": [user_id_filter(user_id), extra]}
