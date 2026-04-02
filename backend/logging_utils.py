import json
import logging
from datetime import datetime, timezone


def configure_logging() -> None:
    root_logger = logging.getLogger()
    if getattr(configure_logging, '_configured', False):
        return

    logging.basicConfig(level=logging.INFO, format='%(message)s')
    for handler in root_logger.handlers:
        handler.setFormatter(logging.Formatter('%(message)s'))

    configure_logging._configured = True


def log_event(logger: logging.Logger, level: str, event: str, **fields) -> None:
    payload = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'level': level.upper(),
        'event': event,
        **fields,
    }
    getattr(logger, level.lower())(json.dumps(payload, default=str, ensure_ascii=True))