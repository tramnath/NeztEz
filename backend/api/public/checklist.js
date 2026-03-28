const token = window.location.pathname.split('/').pop();
const meta = document.getElementById('meta');
const roomsContainer = document.getElementById('roomsContainer');
const result = document.getElementById('result');

let payload;

const setResult = (value) => {
  result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const loadChecklist = async () => {
  const response = await fetch(`/public/checklists/${token}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load checklist');
  }

  payload = data;
  const { property, walkthrough, share } = data;

  meta.textContent = `${property.name} | ${property.address || 'No address'} | ${walkthrough.type.toUpperCase()} | Expires: ${new Date(share.expiresAt).toLocaleString()}`;

  roomsContainer.innerHTML = '';
  property.rooms.forEach((room) => {
    const roomWrap = document.createElement('div');
    roomWrap.className = 'row stack';

    const heading = document.createElement('strong');
    heading.textContent = room.name;
    roomWrap.appendChild(heading);

    (room.components || []).forEach((component) => {
      const label = document.createElement('label');
      label.className = 'row stack';

      const title = document.createElement('span');
      title.textContent = component.name;

      const textarea = document.createElement('textarea');
      textarea.rows = 2;
      textarea.placeholder = 'Condition notes, damages, photos reference, etc.';
      textarea.dataset.roomId = room.id;
      textarea.dataset.componentId = component.id;

      label.appendChild(title);
      label.appendChild(textarea);
      roomWrap.appendChild(label);
    });

    roomsContainer.appendChild(roomWrap);
  });
};

const submitChecklist = async () => {
  const notes = {};
  roomsContainer.querySelectorAll('textarea').forEach((textarea) => {
    const roomId = textarea.dataset.roomId;
    const componentId = textarea.dataset.componentId;
    if (!roomId || !componentId) {
      return;
    }

    if (!notes[roomId]) {
      notes[roomId] = {};
    }

    notes[roomId][componentId] = textarea.value;
  });

  const body = {
    submittedByName: document.getElementById('submittedByName').value,
    submittedByEmail: document.getElementById('submittedByEmail').value,
    results: {
      walkthroughType: payload.walkthrough.type,
      propertyId: payload.property.id,
      rooms: notes,
      submittedAtClient: new Date().toISOString(),
    },
  };

  const response = await fetch(`/public/checklists/${token}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Unable to submit checklist');
  }

  setResult(data);
  document.getElementById('submitBtn').disabled = true;
  roomsContainer.querySelectorAll('textarea').forEach((textarea) => {
    textarea.disabled = true;
  });
};

document.getElementById('submitBtn').addEventListener('click', () => {
  submitChecklist().catch((error) => setResult(String(error)));
});

loadChecklist().catch((error) => setResult(String(error)));
