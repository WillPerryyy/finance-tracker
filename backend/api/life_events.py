import uuid
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..storage import read_json, write_json
from ..models.life_event import (
    LifeEvent, LifeEventsData, LifeEventCreate, LifeEventUpdate,
    EVENT_TYPES, BUCKET_LABELS,
)

router = APIRouter(prefix="/api/life-events", tags=["life-events"])


def _load() -> LifeEventsData:
    raw = read_json(settings.life_events_path)
    return LifeEventsData(**raw) if raw else LifeEventsData()


def _save(data: LifeEventsData) -> None:
    write_json(settings.life_events_path, data.model_dump())


@router.get("")
def list_events() -> list[LifeEvent]:
    return sorted(_load().events, key=lambda e: e.year)


@router.get("/meta")
def event_meta() -> dict:
    """Return event type and bucket label maps for the frontend."""
    return {"event_types": EVENT_TYPES, "bucket_labels": BUCKET_LABELS}


@router.post("", status_code=201)
def create_event(body: LifeEventCreate) -> LifeEvent:
    data = _load()
    event = LifeEvent(id=f"evt_{uuid.uuid4().hex[:8]}", **body.model_dump())
    data.events.append(event)
    _save(data)
    return event


@router.put("/{event_id}")
def update_event(event_id: str, body: LifeEventUpdate) -> LifeEvent:
    data = _load()
    for i, evt in enumerate(data.events):
        if evt.id == event_id:
            updated = evt.model_copy(update=body.model_dump(exclude_unset=True))
            data.events[i] = updated
            _save(data)
            return updated
    raise HTTPException(404, f"Event {event_id} not found")


@router.delete("/{event_id}")
def delete_event(event_id: str) -> dict:
    data = _load()
    before = len(data.events)
    data.events = [e for e in data.events if e.id != event_id]
    if len(data.events) == before:
        raise HTTPException(404, f"Event {event_id} not found")
    _save(data)
    return {"deleted": event_id}
