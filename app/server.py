"""Entry point — exposes the FastAPI app from the `enviz` package.

    uvicorn server:app --host 127.0.0.1 --port 8765

The application is organised as a package (see enviz/) rather than one file.
"""
from enviz.server import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
