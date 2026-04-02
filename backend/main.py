import logging
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from backend.routers.admin import router as admin_router
    from backend.config import CORS_ALLOW_CREDENTIALS, CORS_ALLOW_ORIGINS
    from backend.logging_utils import configure_logging, log_event
    from backend.routers.activity import router as activity_router
    from backend.routers.auth import router as auth_router
    from backend.routers.expenses import router as expenses_router
    from backend.routers.health import router as health_router
    from backend.routers.insights import router as insights_router
    from backend.routers.sessions import router as sessions_router
    from backend.routers.vehicles import router as vehicles_router
except ModuleNotFoundError:
    from routers.admin import router as admin_router
    from config import CORS_ALLOW_CREDENTIALS, CORS_ALLOW_ORIGINS
    from logging_utils import configure_logging, log_event
    from routers.activity import router as activity_router
    from routers.auth import router as auth_router
    from routers.expenses import router as expenses_router
    from routers.health import router as health_router
    from routers.insights import router as insights_router
    from routers.sessions import router as sessions_router
    from routers.vehicles import router as vehicles_router

configure_logging()
logger = logging.getLogger('garageos.api')

app = FastAPI(title="GarageOS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware('http')
async def attach_request_context(request: Request, call_next):
    request_id = request.headers.get('x-request-id', str(uuid.uuid4()))
    request.state.request_id = request_id
    started_at = time.perf_counter()

    response = await call_next(request)
    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    response.headers['X-Request-ID'] = request_id

    if response.status_code >= 500:
        log_event(
            logger,
            'error',
            'request_failed',
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
            client_ip=request.client.host if request.client else None,
        )

    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    log_event(
        logger,
        'warning',
        'request_validation_failed',
        request_id=getattr(request.state, 'request_id', None),
        method=request.method,
        path=request.url.path,
        status_code=422,
        client_ip=request.client.host if request.client else None,
        errors=exc.errors(),
    )
    return JSONResponse(status_code=422, content={'detail': exc.errors()})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code >= 500:
        log_event(
            logger,
            'error',
            'http_exception',
            request_id=getattr(request.state, 'request_id', None),
            method=request.method,
            path=request.url.path,
            status_code=exc.status_code,
            client_ip=request.client.host if request.client else None,
            detail=exc.detail,
        )

    return JSONResponse(status_code=exc.status_code, content={'detail': exc.detail}, headers=getattr(exc, 'headers', None))


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log_event(
        logger,
        'error',
        'unhandled_exception',
        request_id=getattr(request.state, 'request_id', None),
        method=request.method,
        path=request.url.path,
        status_code=500,
        client_ip=request.client.host if request.client else None,
        error_type=type(exc).__name__,
        detail=str(exc),
    )
    return JSONResponse(status_code=500, content={'detail': 'Internal Server Error'})

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(vehicles_router)
app.include_router(expenses_router)
app.include_router(activity_router)
app.include_router(sessions_router)
app.include_router(insights_router)
