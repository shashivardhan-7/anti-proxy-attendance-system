from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.attendance import router as attendance_router

app = FastAPI(title="AntiProxy API", version="0.1.0")

if settings.api_env == "development":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:8081",
            "http://127.0.0.1:8081",
            "http://localhost:19006",
            "http://127.0.0.1:19006",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(attendance_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "antiproxy-api"}