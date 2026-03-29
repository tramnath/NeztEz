const authOutput = document.getElementById('authOutput');
const propertyOutput = document.getElementById('propertyOutput');
const walkOutput = document.getElementById('walkOutput');
const shareArea = document.getElementById('shareArea');
const templateList = document.getElementById('templateList');
const roomConfigEditor = document.getElementById('roomConfigEditor');
const roomsText = document.getElementById('roomsText');
const customRoomNameInput = document.getElementById('customRoomName');
const propertySection = document.getElementById('propertySection');
const walkthroughSection = document.getElementById('walkthroughSection');
const existingPropertyGrid = document.getElementById('existingPropertyGrid');

const propertySelect = document.getElementById('propertySelect');
const walkSelect = document.getElementById('walkSelect');

const state = {
  token: '',
  properties: [],
  walkthroughs: [],
  templates: [],
  selectedTemplateId: null,
  selectedExistingPropertyId: null,
  roomConfigs: [],
};

const generateId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

const mkComponent = (name, detailFields = []) => ({
  id: generateId(),
  name,
  detailFields,
  defaultDetails: {},
  defaultNote: '',
});

const cloneDefaultDetails = (value) => ({ ...(value || {}) });

const cloneComponentTemplate = (component) => ({
  id: generateId(),
  name: component.name,
  detailFields: [...(component.detailFields || [])],
  defaultDetails: cloneDefaultDetails(component.defaultDetails),
  defaultNote: component.defaultNote || '',
});

const applyComponentOverrides = (baseComponents, overrides = []) => {
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return baseComponents.map(cloneComponentTemplate);
  }

  const nextComponents = baseComponents.map(cloneComponentTemplate);

  overrides.forEach((override) => {
    const name = typeof override?.name === 'string' ? override.name.trim() : '';
    if (!name) {
      return;
    }

    const detailFields = Array.isArray(override.detailFields)
      ? override.detailFields
          .filter((field) => typeof field === 'string')
          .map((field) => field.trim())
          .filter(Boolean)
      : undefined;

    const match = nextComponents.find(
      (component) => component.name.trim().toLowerCase() === name.toLowerCase(),
    );

    if (match) {
      if (detailFields) {
        match.detailFields = [...detailFields];
      }
      match.defaultDetails = cloneDefaultDetails(override.defaultDetails);
      match.defaultNote = typeof override.defaultNote === 'string' ? override.defaultNote.trim() : '';
      return;
    }

    nextComponents.push({
      id: generateId(),
      name,
      detailFields: detailFields ? [...detailFields] : [],
      defaultDetails: cloneDefaultDetails(override.defaultDetails),
      defaultNote: typeof override.defaultNote === 'string' ? override.defaultNote.trim() : '',
    });
  });

  return nextComponents;
};

const commonComponents = () => [
  mkComponent('Doors/Locks'),
  mkComponent('Floor', ['Type']),
  mkComponent('Walls'),
  mkComponent('Ceiling'),
  mkComponent('Light Fixtures'),
  mkComponent('Switches and Outlets'),
  mkComponent('Windows'),
  mkComponent('Window Coverings', ['Type']),
  mkComponent('Other'),
];

const bathroomExtras = () => [
  mkComponent('Cabinets/Counters'),
  mkComponent('Exhaust Fan'),
  mkComponent('Tub/Shower'),
  mkComponent('Toilet'),
  mkComponent('Sink/Faucet'),
];

const kitchenExtras = () => [
  mkComponent('Cabinets'),
  mkComponent('Counters', ['Type']),
  mkComponent('Dishwasher', ['Model', 'Make', 'Serial']),
  mkComponent('Stove/Cooktop', ['Model', 'Make', 'Serial']),
  mkComponent('Exhaust Fan/Range Hood', ['Model', 'Make', 'Serial']),
  mkComponent('Refrigerator', ['Model', 'Make', 'Serial']),
  mkComponent('Microwave', ['Model', 'Make', 'Serial']),
  mkComponent('Oven', ['Model', 'Make', 'Serial']),
  mkComponent('Garbage Disposal'),
];

const garageExtras = () => [
  mkComponent('Garage Door'),
  mkComponent('Garage Door Opener', ['Model', 'Make', 'Serial']),
  mkComponent('Water Heater', ['Model', 'Make', 'Serial']),
  mkComponent('Furnace', ['Model', 'Make', 'Serial']),
];

const otherAreaComponents = () => [
  mkComponent('Smoke Detector'),
  mkComponent('CO Detector'),
  mkComponent('Air Con', ['Model', 'Make', 'Serial']),
  mkComponent('Gutters and Downspouts'),
  mkComponent('Keys'),
];

const groundsComponents = () => [
  mkComponent('Fence/Gates'),
  mkComponent('Landscape'),
  mkComponent('Lawn'),
  mkComponent('Driveway/Walkway/Patio'),
  mkComponent('Hosebibs'),
  mkComponent('BBQ Gas Outlet'),
];

const bedroomComponents = () => [
  ...commonComponents(),
  mkComponent('Smoke Detector'),
];

const normalizeSpaceName = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const createRoomTemplateFromSpaceName = (spaceName) => {
  const normalized = normalizeSpaceName(spaceName);
  let components = commonComponents();

  if (normalized.includes('kitchen')) {
    components = [...commonComponents(), ...kitchenExtras()];
  } else if (normalized.includes('garage')) {
    components = [...commonComponents(), ...garageExtras()];
  } else if (normalized.includes('ground')) {
    components = groundsComponents();
  } else if (normalized.includes('other area')) {
    components = otherAreaComponents();
  } else if (normalized.includes('bath') || normalized === 'mater bath') {
    components = [...commonComponents(), ...bathroomExtras()];
  } else if (normalized.includes('bedroom')) {
    components = bedroomComponents();
  } else if (normalized.includes('office') || normalized.includes('den')) {
    components = commonComponents();
  }

  return {
    name: spaceName,
    components,
  };
};

const createRoomTemplateFromSpace = (space) => {
  if (typeof space === 'string') {
    return createRoomTemplateFromSpaceName(space);
  }

  const name = typeof space?.name === 'string' ? space.name.trim() : '';
  if (!name) {
    return createRoomTemplateFromSpaceName('Untitled Space');
  }

  const baseRoom = createRoomTemplateFromSpaceName(name);
  return {
    ...baseRoom,
    name,
    components: applyComponentOverrides(baseRoom.components, space.components),
  };
};

const setOutput = (el, value) => {
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const setAuthenticated = (isAuthenticated) => {
  propertySection.hidden = !isAuthenticated;
  walkthroughSection.hidden = !isAuthenticated;
};

const persistToken = (token) => {
  state.token = token;
};

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: state.token ? `Bearer ${state.token}` : '',
});

const parseRooms = (text) => {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((spaceName) => createRoomTemplateFromSpaceName(spaceName));
};

const cloneRoomConfig = (room) => {
  const copyBase = room.name.trim() || 'Room';
  const existingNames = new Set(state.roomConfigs.map((item) => item.name));
  let nextIndex = 2;
  let nextName = `${copyBase} ${nextIndex}`;

  while (existingNames.has(nextName)) {
    nextIndex += 1;
    nextName = `${copyBase} ${nextIndex}`;
  }

  return {
    name: nextName,
    components: room.components.map((component) => ({
      id: generateId(),
      name: component.name,
      detailFields: [...(component.detailFields || [])],
      defaultDetails: cloneDefaultDetails(component.defaultDetails),
      defaultNote: component.defaultNote || '',
    })),
  };
};

const moveRoomConfig = (fromIndex, toIndex) => {
  if (toIndex < 0 || toIndex >= state.roomConfigs.length) {
    return;
  }

  const [room] = state.roomConfigs.splice(fromIndex, 1);
  state.roomConfigs.splice(toIndex, 0, room);
  renderRoomEditor();
};

const moveComponentInRoom = (roomIndex, fromIndex, toIndex) => {
  const components = state.roomConfigs[roomIndex]?.components;
  if (!components || toIndex < 0 || toIndex >= components.length) {
    return;
  }

  const [component] = components.splice(fromIndex, 1);
  components.splice(toIndex, 0, component);
  renderRoomEditor();
};

let draggedRoomIndex = null;

const renderRoomEditor = () => {
  roomConfigEditor.innerHTML = '';

  state.roomConfigs.forEach((room, roomIndex) => {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.draggable = true;

    card.addEventListener('dragstart', (event) => {
      if (event.target?.closest?.('.component-chip')) {
        event.preventDefault();
        return;
      }

      draggedRoomIndex = roomIndex;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(roomIndex));
      card.classList.add('is-dragging');
    });

    card.addEventListener('dragend', () => {
      draggedRoomIndex = null;
      card.classList.remove('is-dragging');
      roomConfigEditor
        .querySelectorAll('.room-card.is-drop-target')
        .forEach((el) => el.classList.remove('is-drop-target'));
    });

    card.addEventListener('dragover', (event) => {
      if (draggedRoomIndex === null || draggedRoomIndex === roomIndex) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      card.classList.add('is-drop-target');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('is-drop-target');
    });

    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('is-drop-target');

      if (draggedRoomIndex === null || draggedRoomIndex === roomIndex) {
        return;
      }

      moveRoomConfig(draggedRoomIndex, roomIndex);
    });

    const header = document.createElement('div');
    header.className = 'room-card-header';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'room-drag-handle';
    dragHandle.textContent = 'Drag';
    dragHandle.title = 'Drag to reorder room';

    const roomName = document.createElement('input');
    roomName.value = room.name;
    roomName.placeholder = 'Room name';
    roomName.addEventListener('input', (event) => {
      state.roomConfigs[roomIndex].name = event.target.value;
    });

    const cloneBtn = document.createElement('button');
    cloneBtn.type = 'button';
    cloneBtn.textContent = 'Clone';
    cloneBtn.addEventListener('click', () => {
      state.roomConfigs.push(cloneRoomConfig(room));
      renderRoomEditor();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      state.roomConfigs.splice(roomIndex, 1);
      renderRoomEditor();
    });

    header.appendChild(dragHandle);
    header.appendChild(roomName);
    header.appendChild(cloneBtn);
    header.appendChild(deleteBtn);
    card.appendChild(header);

    const componentList = document.createElement('div');
    componentList.className = 'component-chip-list';
    let draggedComponentIndex = null;

    room.components.forEach((component, componentIndex) => {
      const chip = document.createElement('div');
      chip.className = 'component-chip';
      chip.draggable = true;
      chip.title = 'Drag to reorder component';

      chip.addEventListener('dragstart', (event) => {
        draggedComponentIndex = componentIndex;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(componentIndex));
        chip.classList.add('is-dragging');
      });

      chip.addEventListener('dragend', () => {
        draggedComponentIndex = null;
        chip.classList.remove('is-dragging');
        componentList
          .querySelectorAll('.component-chip.is-drop-target')
          .forEach((el) => el.classList.remove('is-drop-target'));
      });

      chip.addEventListener('dragover', (event) => {
        if (draggedComponentIndex === null || draggedComponentIndex === componentIndex) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        chip.classList.add('is-drop-target');
      });

      chip.addEventListener('dragleave', () => {
        chip.classList.remove('is-drop-target');
      });

      chip.addEventListener('drop', (event) => {
        event.preventDefault();
        chip.classList.remove('is-drop-target');

        if (draggedComponentIndex === null || draggedComponentIndex === componentIndex) {
          return;
        }

        moveComponentInRoom(roomIndex, draggedComponentIndex, componentIndex);
      });

      const nameSpan = document.createElement('span');
      nameSpan.textContent = component.name;
      chip.appendChild(nameSpan);

      if (component.detailFields?.length) {
        const detail = document.createElement('span');
        detail.className = 'component-detail';
        detail.textContent = `(${component.detailFields.join(', ')})`;
        chip.appendChild(detail);
      }

      const defaults = [];
      if (component.defaultDetails && Object.keys(component.defaultDetails).length > 0) {
        defaults.push(
          `defaults: ${Object.entries(component.defaultDetails)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ')}`,
        );
      }
      if (component.defaultNote) {
        defaults.push(`note: ${component.defaultNote}`);
      }
      if (defaults.length > 0) {
        const defaultsDetail = document.createElement('span');
        defaultsDetail.className = 'component-detail';
        defaultsDetail.textContent = ` ${defaults.join(' | ')}`;
        chip.appendChild(defaultsDetail);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'x';
      remove.addEventListener('click', () => {
        state.roomConfigs[roomIndex].components.splice(componentIndex, 1);
        renderRoomEditor();
      });
      chip.appendChild(remove);

      componentList.appendChild(chip);
    });

    card.appendChild(componentList);

    const addRow = document.createElement('div');
    addRow.className = 'row';

    const componentNameInput = document.createElement('input');
    componentNameInput.placeholder = 'Custom component name';

    const addComponentBtn = document.createElement('button');
    addComponentBtn.type = 'button';
    addComponentBtn.textContent = 'Add Component';
    addComponentBtn.addEventListener('click', () => {
      const name = componentNameInput.value.trim();
      if (!name) {
        return;
      }

      state.roomConfigs[roomIndex].components.push(mkComponent(name));
      componentNameInput.value = '';
      renderRoomEditor();
    });

    addRow.appendChild(componentNameInput);
    addRow.appendChild(addComponentBtn);
    card.appendChild(addRow);

    roomConfigEditor.appendChild(card);
  });
};

const regenerateRoomConfigsFromText = () => {
  state.roomConfigs = parseRooms(roomsText.value);
  renderRoomEditor();
};

const applyTemplateToDraft = (template) => {
  state.selectedExistingPropertyId = null;
  document.getElementById('propertyName').value = template.name;
  document.getElementById('propertyAddress').value = template.address || '';
  roomsText.value = (template.spaces || [])
    .map((space) => (typeof space === 'string' ? space : space?.name || ''))
    .filter(Boolean)
    .join('\n');
  state.roomConfigs = (template.spaces || []).map((space) => createRoomTemplateFromSpace(space));
  renderRoomEditor();
  renderProperties();
};

const applyExistingPropertyToDraft = (property, { clone = false } = {}) => {
  state.selectedTemplateId = null;
  document.getElementById('propertyName').value = clone ? `${property.name} Copy` : property.name;
  document.getElementById('propertyAddress').value = property.address || '';

  state.roomConfigs = (property.rooms || []).map((room) => ({
    name: room.name,
    components: (room.components || []).map((component) => ({
      id: generateId(),
      name: component.name,
      detailFields: [...(component.detailFields || [])],
      defaultDetails: cloneDefaultDetails(component.defaultDetails),
      defaultNote: component.defaultNote || '',
    })),
  }));

  roomsText.value = state.roomConfigs.map((room) => room.name).join('\n');
  renderRoomEditor();
};

const resetDraftFromScratch = () => {
  document.getElementById('propertyName').value = '';
  document.getElementById('propertyAddress').value = '';
  roomsText.value = '';
  state.roomConfigs = [];
  state.selectedTemplateId = null;
  state.selectedExistingPropertyId = null;
  renderTemplatePills();
  renderProperties();
  renderRoomEditor();
};

const renderTemplatePills = () => {
  templateList.innerHTML = '';

  state.templates.forEach((template) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = template.name;
    button.addEventListener('click', () => {
      state.selectedTemplateId = template.id;
      applyTemplateToDraft(template);
      renderTemplatePills();
    });

    if (state.selectedTemplateId === template.id) {
      button.style.opacity = '1';
    } else {
      button.style.opacity = '0.78';
    }

    templateList.appendChild(button);
  });
};

const renderProperties = () => {
  propertySelect.innerHTML = '';
  existingPropertyGrid.innerHTML = '';

  state.properties.forEach((property) => {
    const option = document.createElement('option');
    option.value = property.id;
    option.textContent = `${property.name} (${property.rooms.length} rooms)`;
    propertySelect.appendChild(option);

    const homeItem = document.createElement('div');
    homeItem.className = 'home-item';

    const homeButton = document.createElement('button');
    homeButton.type = 'button';
    homeButton.className = 'home-button';
    if (state.selectedExistingPropertyId === property.id) {
      homeButton.classList.add('is-selected');
    }
    homeButton.title = `Load ${property.name}`;

    const homeName = document.createElement('span');
    homeName.className = 'home-name';
    homeName.textContent = property.name;

    const cloneBtn = document.createElement('button');
    cloneBtn.type = 'button';
    cloneBtn.className = 'home-clone-btn';
    cloneBtn.textContent = 'Clone';

    homeButton.addEventListener('click', () => {
      state.selectedExistingPropertyId = property.id;
      applyExistingPropertyToDraft(property, { clone: false });
      setOutput(propertyOutput, `Loaded configuration from property: ${property.name}`);
    });

    cloneBtn.addEventListener('click', () => {
      state.selectedExistingPropertyId = property.id;
      applyExistingPropertyToDraft(property, { clone: true });
      setOutput(propertyOutput, `Clone draft created from property: ${property.name}`);
      renderProperties();
    });

    homeItem.appendChild(homeButton);
    homeItem.appendChild(homeName);
    homeItem.appendChild(cloneBtn);
    existingPropertyGrid.appendChild(homeItem);
  });

  if (state.properties.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No existing properties yet. Create your first one from a template or from scratch.';
    existingPropertyGrid.appendChild(empty);
  }
};

const renderWalkthroughs = () => {
  walkSelect.innerHTML = '';
  state.walkthroughs.forEach((walk) => {
    const option = document.createElement('option');
    option.value = walk.id;
    option.textContent = `${walk.type.toUpperCase()} - ${walk.id.slice(0, 8)}...`;
    walkSelect.appendChild(option);
  });
};

const api = async (path, init = {}) => {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || JSON.stringify(data));
  }
  return data;
};

const refreshProperties = async () => {
  const data = await api('/admin/properties', {
    headers: authHeaders(),
  });
  state.properties = data.properties || [];
  renderProperties();
  setOutput(propertyOutput, data);

  const walkData = await api('/admin/walkthroughs', {
    headers: authHeaders(),
  });
  state.walkthroughs = walkData.walkthroughs || [];
  renderWalkthroughs();
  setOutput(walkOutput, walkData);
};

document.getElementById('signupBtn').addEventListener('click', async () => {
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const data = await api('/admin/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    persistToken(data.token);
    setAuthenticated(true);
    setOutput(authOutput, data);
    await refreshProperties();
  } catch (error) {
    setOutput(authOutput, String(error));
  }
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const data = await api('/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    persistToken(data.token);
    setAuthenticated(true);
    setOutput(authOutput, data);
    await refreshProperties();
  } catch (error) {
    setAuthenticated(false);
    setOutput(authOutput, String(error));
  }
});

document.getElementById('meBtn').addEventListener('click', async () => {
  try {
    const data = await api('/admin/auth/me', { headers: authHeaders() });
    setOutput(authOutput, data);
  } catch (error) {
    setOutput(authOutput, String(error));
  }
});

document.getElementById('createPropertyBtn').addEventListener('click', async () => {
  try {
    const name = document.getElementById('propertyName').value;
    const address = document.getElementById('propertyAddress').value;
    const rooms = state.roomConfigs.length > 0 ? state.roomConfigs : parseRooms(roomsText.value);

    const data = await api('/admin/properties', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, address, rooms }),
    });
    setOutput(propertyOutput, data);
    await refreshProperties();
  } catch (error) {
    setOutput(propertyOutput, String(error));
  }
});

document.getElementById('generateRoomsBtn').addEventListener('click', () => {
  regenerateRoomConfigsFromText();
});

document.getElementById('addBedroomBtn').addEventListener('click', () => {
  const existingBedrooms = state.roomConfigs.filter((room) => room.name.toLowerCase().includes('bedroom')).length;
  const nextName = existingBedrooms === 0 ? 'Bedroom' : `Bedroom ${existingBedrooms + 1}`;
  state.roomConfigs.push(createRoomTemplateFromSpaceName(nextName));
  renderRoomEditor();
});

document.getElementById('addCustomRoomBtn').addEventListener('click', () => {
  const customName = customRoomNameInput.value.trim();
  if (!customName) {
    return;
  }

  state.roomConfigs.push(createRoomTemplateFromSpaceName(customName));
  customRoomNameInput.value = '';
  renderRoomEditor();
});

document.getElementById('startScratchBtn').addEventListener('click', () => {
  resetDraftFromScratch();
  setOutput(propertyOutput, 'Started a new property draft from scratch.');
});

document.getElementById('refreshBtn').addEventListener('click', async () => {
  try {
    await refreshProperties();
  } catch (error) {
    setOutput(propertyOutput, String(error));
  }
});

document.getElementById('createWalkBtn').addEventListener('click', async () => {
  try {
    const propertyId = propertySelect.value;
    const type = document.getElementById('walkType').value;

    const data = await api('/admin/walkthroughs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ propertyId, type }),
    });
    setOutput(walkOutput, data);
    await refreshProperties();
  } catch (error) {
    setOutput(walkOutput, String(error));
  }
});

document.getElementById('shareBtn').addEventListener('click', async () => {
  try {
    const walkthroughId = walkSelect.value;
    const data = await api(`/admin/walkthroughs/${walkthroughId}/share`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ expiresInHours: 24 }),
    });

    shareArea.innerHTML = '';

    const link = document.createElement('a');
    link.href = data.checklistUrl;
    link.textContent = data.checklistUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';

    shareArea.appendChild(link);

    if (data.qrCodeDataUrl) {
      const image = document.createElement('img');
      image.src = data.qrCodeDataUrl;
      image.alt = 'Walkthrough QR';
      image.width = 250;
      image.height = 250;
      shareArea.appendChild(image);
    }
  } catch (error) {
    shareArea.textContent = String(error);
  }
});

setAuthenticated(false);

fetch('/static/property-templates.json')
  .then((response) => response.json())
  .then((data) => {
    state.templates = Array.isArray(data?.properties) ? data.properties : [];
    state.selectedTemplateId = null;
    renderTemplatePills();
  })
  .catch(() => undefined);
