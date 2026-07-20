"""
HSMC Python Backend — FastAPI Entry Point.

Production service for backtesting, optimization, and market metrics.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router
from config import PORT

app = FastAPI(
    title="HSMC Python Backend",
    version="1.0.0",
    description="Autonomous AI hedge fund backend — backtesting, optimization, metrics.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
