import uvicorn

from img_cleaner_backend.app import app


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
