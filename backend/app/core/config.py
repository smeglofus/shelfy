from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Shelfy API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://shelfy:shelfy@localhost:5432/shelfy"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    admin_email: str | None = None
    admin_password: str | None = None
    seed_admin_on_startup: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret_key(cls, value: str, info: object) -> str:
        env_value = getattr(info, "data", {}).get("environment")
        if value == "change-me" and env_value != "development":
            raise ValueError("JWT_SECRET_KEY must not use default value outside development")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
