"""Database dependencies and utilities"""
from pymongo.database import Database

# Global database instance
_db = None


def set_db(database: Database):
    """Set the global database instance"""
    global _db
    _db = database


def get_db() -> Database:
    """Get database instance for dependency injection"""
    if _db is None:
        raise RuntimeError("Database not initialized. Call set_db() first.")
    return _db
