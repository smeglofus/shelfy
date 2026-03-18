from __future__ import annotations

from time import perf_counter

from fastapi import Request
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    labelnames=("method", "endpoint", "status"),
)
BOOK_PROCESSING_JOBS_TOTAL = Gauge(
    "book_processing_jobs_total",
    "Book processing jobs by status",
    labelnames=("status",),
)
EXTERNAL_API_CALLS_TOTAL = Counter(
    "external_api_calls_total",
    "External metadata API calls by provider",
    labelnames=("provider",),
)
EXTERNAL_API_LATENCY_SECONDS = Histogram(
    "external_api_latency_seconds",
    "External metadata API latency",
    labelnames=("provider",),
)


def endpoint_label(request: Request) -> str:
    route = request.scope.get("route")
    if route is not None and hasattr(route, "path"):
        return str(route.path)
    return request.url.path


def record_http_request(request: Request, status_code: int) -> None:
    HTTP_REQUESTS_TOTAL.labels(
        method=request.method,
        endpoint=endpoint_label(request),
        status=str(status_code),
    ).inc()


def observe_external_api_latency(provider: str, start_time: float) -> None:
    EXTERNAL_API_LATENCY_SECONDS.labels(provider=provider).observe(perf_counter() - start_time)


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
