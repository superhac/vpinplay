# Use official Python runtime as base image
FROM python:3.13-slim

# Set working directory
WORKDIR /app

# Install system dependencies and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    rustc \
    cargo \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8888/health')"

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8888"]
