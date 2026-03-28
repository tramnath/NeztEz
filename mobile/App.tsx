import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import propertyTemplatesFile from './property-templates.json';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MailComposer from 'expo-mail-composer';
import * as MediaLibrary from 'expo-media-library';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Condition = 'G' | 'F' | 'P' | '';
type InspectionType = 'Move-In' | 'Move-Out' | 'Routine';
type AppTab = 'Admin' | 'Walkthrough';

type ComponentTemplate = {
  id: string;
  name: string;
  detailFields: string[];
};

type RoomTemplate = {
  id: string;
  key: string;
  name: string;
  componentDraft: string;
  components: ComponentTemplate[];
};

type ChecklistItem = {
  id: string;
  name: string;
  detailFields: string[];
  details: Record<string, string>;
  condition: Condition;
  note: string;
  photoUris: string[];
  photoUri?: string;
};

type InspectionRoom = {
  id: string;
  name: string;
  items: ChecklistItem[];
};

type Walkthrough = {
  inspectionType: InspectionType;
  propertyName: string;
  propertyAddress: string;
  tenantName: string;
  createdAt: string;
  rooms: InspectionRoom[];
};

type PropertyTemplate = {
  id: string;
  name: string;
  address: string;
  spaces: string[];
};

type PropertyTemplateFile = {
  version: number;
  properties: PropertyTemplate[];
};

type SelectMenuState = {
  roomId: string;
  itemId: string;
  field: string;
  options: string[];
};

const colors = {
  bg: '#f2f2f3',
  panel: '#ffffff',
  border: '#d5d6d9',
  text: '#2e2e33',
  muted: '#5f6168',
  primary: '#52565d',
  primaryDeep: '#3d4148',
  accent: '#7d1f2a',
  success: '#2f6c46',
  danger: '#7f1b24',
  fieldBg: '#f8f8f9',
};

const headerLogo = require('./assets/DiamondDigsLogo.png');
const whatsappLogo = require('./assets/whatsapp.jpg');
const PHOTO_ARCHIVE_ALBUM = 'DiamondDigs Inspections';

const saveOriginalPhotoToLibrary = async (uri: string) => {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  if (!permission.granted) {
    return { saved: false, reason: 'permission' as const };
  }

  try {
    const savedAsset = await MediaLibrary.createAssetAsync(uri);
    const existingAlbum = await MediaLibrary.getAlbumAsync(PHOTO_ARCHIVE_ALBUM);

    if (existingAlbum) {
      await MediaLibrary.addAssetsToAlbumAsync([savedAsset], existingAlbum, false);
    } else {
      await MediaLibrary.createAlbumAsync(PHOTO_ARCHIVE_ALBUM, savedAsset, false);
    }

    return { saved: true as const };
  } catch {
    return { saved: false, reason: 'error' as const };
  }
};

const normalizeWalkthrough = (value: Walkthrough | null): Walkthrough | null => {
  if (!value) {
    return value;
  }

  return {
    ...value,
    rooms: value.rooms.map((room) => ({
      ...room,
      items: room.items.map((item) => ({
        ...item,
        photoUris: Array.isArray(item.photoUris)
          ? item.photoUris.filter((uri) => typeof uri === 'string' && uri.length > 0)
          : item.photoUri
            ? [item.photoUri]
            : [],
      })),
    })),
  };
};

const conditions: Condition[] = ['G', 'F', 'P'];
const ADMIN_PASSWORD = 'Admin@123';
const STORAGE_KEY = 'reapp:poc-state:v1';

type PersistedAppState = {
  activeTab: AppTab;
  propertyName: string;
  propertyAddress: string;
  tenantName: string;
  inspectionType: InspectionType;
  roomDraft: string;
  roomTemplates: RoomTemplate[];
  walkthrough: Walkthrough | null;
  pdfUri: string | null;
  currentRoomIndex: number;
  roomPageWidth: number;
  activeNoteItemId: string | null;
  adminUnlocked: boolean;
  selectedTemplateId: string | null;
};

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const mkComponent = (name: string, detailFields: string[] = []): ComponentTemplate => ({
  id: generateId(),
  name,
  detailFields,
});

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

const mkRoom = (key: string, name: string, components: ComponentTemplate[]): RoomTemplate => ({
  id: generateId(),
  key,
  name,
  componentDraft: '',
  components,
});

const createDefaultRoomTemplates = (): RoomTemplate[] => [
  mkRoom('entry', 'Entry', commonComponents()),
  mkRoom('den-office', 'Den/Office', commonComponents()),
  mkRoom('bedroom', 'Bedroom', bedroomComponents()),
  mkRoom('kitchen', 'Kitchen', [...commonComponents(), ...kitchenExtras()]),
  mkRoom('living-room', 'Living Room', commonComponents()),
  mkRoom('powder-bath', 'Powder Bath', [...commonComponents(), ...bathroomExtras()]),
  mkRoom('pantry', 'Pantry', commonComponents()),
  mkRoom('master-bath', 'Master Bath', [...commonComponents(), ...bathroomExtras()]),
  mkRoom('main-bath', 'Main Bath', [...commonComponents(), ...bathroomExtras()]),
  mkRoom('garage', 'Garage', [...commonComponents(), ...garageExtras()]),
  mkRoom('other-area', 'Other Area', otherAreaComponents()),
  mkRoom('grounds', 'Grounds', groundsComponents()),
];

const templateCatalog = propertyTemplatesFile as PropertyTemplateFile;

const normalizeSpaceName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const createRoomTemplateFromSpaceName = (spaceName: string): RoomTemplate => {
  const normalized = normalizeSpaceName(spaceName);

  if (normalized.includes('kitchen')) {
    return mkRoom('kitchen', spaceName, [...commonComponents(), ...kitchenExtras()]);
  }

  if (normalized.includes('garage')) {
    return mkRoom('garage', spaceName, [...commonComponents(), ...garageExtras()]);
  }

  if (normalized.includes('ground')) {
    return mkRoom('grounds', spaceName, groundsComponents());
  }

  if (normalized.includes('other area')) {
    return mkRoom('other-area', spaceName, otherAreaComponents());
  }

  if (normalized.includes('bath') || normalized === 'mater bath') {
    return mkRoom('bathroom', spaceName, [...commonComponents(), ...bathroomExtras()]);
  }

  if (normalized.includes('bedroom')) {
    return mkRoom('bedroom', spaceName, bedroomComponents());
  }

  if (normalized.includes('office') || normalized.includes('den')) {
    return mkRoom('den-office', spaceName, commonComponents());
  }

  return mkRoom(normalized.replace(/\s+/g, '-'), spaceName, commonComponents());
};

const componentDetailsForPdf = (item: ChecklistItem) => {
  if (item.detailFields.length === 0) {
    return '<span style="color:#6b7280;">N/A</span>';
  }

  const parts = item.detailFields
    .map((field) => {
      const value = item.details[field]?.trim();
      return `${escapeHtml(field)}: ${value ? escapeHtml(value) : '<span style="color:#6b7280;">N/A</span>'}`;
    })
    .join('<br/>');

  return parts;
};

const getItemPhotoUris = (item: ChecklistItem) => {
  if (Array.isArray(item.photoUris) && item.photoUris.length > 0) {
    return item.photoUris;
  }

  return item.photoUri ? [item.photoUri] : [];
};

const buildPdfHtml = (walkthrough: Walkthrough) => {
  const roomBlocks = walkthrough.rooms
    .map((room) => {
      const rows = room.items
        .map((item) => {
          const photoUris = getItemPhotoUris(item);
          const imageHtml = photoUris.length > 0
            ? `<div style="display:flex; flex-wrap:wrap; gap:8px;">${photoUris
                .map(
                  (uri, index) =>
                    `<img src="${uri}" alt="${escapeHtml(item.name)} photo ${index + 1}" style="max-width: 140px; max-height: 120px; border: 1px solid #c9d7ea; border-radius: 6px;"/>`,
                )
                .join('')}</div>`
            : '<span style="color:#6b7280;">No photo</span>';

          return `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${componentDetailsForPdf(item)}</td>
              <td>${item.condition || 'Not rated'}</td>
              <td>${item.note ? escapeHtml(item.note) : '<span style="color:#6b7280;">No notes</span>'}</td>
              <td>${imageHtml}</td>
            </tr>
          `;
        })
        .join('');

      return `
        <h2>${escapeHtml(room.name)}</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Details</th>
              <th>Condition</th>
              <th>Notes</th>
              <th>Photo</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    })
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0b1f3f; margin: 24px; }
          h1 { margin-bottom: 4px; color: #004977; }
          h2 { color: #00345b; }
          .meta { color: #2f4771; margin: 2px 0; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #d6e0ee; padding: 8px; vertical-align: top; text-align: left; }
          th { background: #eef3f9; }
        </style>
      </head>
      <body>
        <h1>Inspection Report</h1>
        <p class="meta"><strong>Type:</strong> ${escapeHtml(walkthrough.inspectionType)}</p>
        <p class="meta"><strong>Property:</strong> ${escapeHtml(walkthrough.propertyName)}</p>
        <p class="meta"><strong>Address:</strong> ${escapeHtml(walkthrough.propertyAddress || 'N/A')}</p>
        <p class="meta"><strong>Tenant:</strong> ${escapeHtml(walkthrough.tenantName || 'N/A')}</p>
        <p class="meta"><strong>Date:</strong> ${escapeHtml(new Date(walkthrough.createdAt).toLocaleString())}</p>
        ${roomBlocks}
      </body>
    </html>
  `;
};

const guessImageMimeType = (uri: string) => {
  const normalized = uri.toLowerCase();
  if (normalized.endsWith('.png')) {
    return 'image/png';
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
};

const getDetailOptions = (itemName: string, field: string): string[] | null => {
  const normalizedField = field.trim().toLowerCase();
  const normalizedItem = itemName.trim().toLowerCase();

  if (normalizedField !== 'type') {
    return null;
  }

  if (normalizedItem === 'floor') {
    return ['Carpet', 'Wood', 'Laminate', 'Tile', 'Stone', 'LVP'];
  }

  if (normalizedItem === 'window coverings') {
    return ['Faux wood blinds', 'Honeycomb', 'Drapes', 'None'];
  }

  if (normalizedItem.includes('counter')) {
    return ['Granite', 'Quartz', 'Laminate', 'Other'];
  }

  return null;
};

export default function App() {
  const bottomSafePadding = Platform.OS === 'android' ? 84 : 28;

  const [activeTab, setActiveTab] = useState<AppTab>('Admin');
  const [propertyName, setPropertyName] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [inspectionType, setInspectionType] = useState<InspectionType>('Move-In');

  const [roomDraft, setRoomDraft] = useState('');
  const [roomTemplates, setRoomTemplates] = useState<RoomTemplate[]>(createDefaultRoomTemplates());
  const [walkthrough, setWalkthrough] = useState<Walkthrough | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [currentRoomIndex, setCurrentRoomIndex] = useState(0);
  const [roomPageWidth, setRoomPageWidth] = useState(1);
  const [roomPageHeights, setRoomPageHeights] = useState<Record<string, number>>({});
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [activeNoteItemId, setActiveNoteItemId] = useState<string | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    templateCatalog.properties[0]?.id ?? null,
  );
  const [selectMenu, setSelectMenu] = useState<SelectMenuState | null>(null);
  const [isRoomMenuOpen, setIsRoomMenuOpen] = useState(false);

  const pagerRef = useRef<ScrollView | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  const showBanner = (message: string) => {
    setBannerMessage(message);
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
    }

    if (bannerFadeTimerRef.current) {
      clearTimeout(bannerFadeTimerRef.current);
    }

    bannerOpacity.stopAnimation();
    bannerOpacity.setValue(0);

    Animated.timing(bannerOpacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      bannerFadeTimerRef.current = setTimeout(() => {
        Animated.timing(bannerOpacity, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) {
            setBannerMessage(null);
          }
        });
      }, 1300);
    });

    bannerTimerRef.current = setTimeout(() => {
      setBannerMessage(null);
    }, 2600);
  };

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }

      if (bannerFadeTimerRef.current) {
        clearTimeout(bannerFadeTimerRef.current);
      }
    };
  }, [bannerOpacity]);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          setHasHydrated(true);
          return;
        }

        const parsed = JSON.parse(raw) as PersistedAppState;
        setActiveTab(parsed.activeTab ?? 'Admin');
        setPropertyName(parsed.propertyName ?? '');
        setPropertyAddress(parsed.propertyAddress ?? '');
        setTenantName(parsed.tenantName ?? '');
        setInspectionType(parsed.inspectionType ?? 'Move-In');
        setRoomDraft(parsed.roomDraft ?? '');
        setRoomTemplates(parsed.roomTemplates?.length ? parsed.roomTemplates : createDefaultRoomTemplates());
        setWalkthrough(normalizeWalkthrough(parsed.walkthrough ?? null));
        setPdfUri(parsed.pdfUri ?? null);
        setCurrentRoomIndex(parsed.currentRoomIndex ?? 0);
        setRoomPageWidth(parsed.roomPageWidth ?? 1);
        setActiveNoteItemId(parsed.activeNoteItemId ?? null);
        setAdminUnlocked(Boolean(parsed.adminUnlocked));
        setSelectedTemplateId(parsed.selectedTemplateId ?? templateCatalog.properties[0]?.id ?? null);
      } catch {
        setRoomTemplates(createDefaultRoomTemplates());
      } finally {
        setHasHydrated(true);
      }
    };

    hydrate();
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const payload: PersistedAppState = {
      activeTab,
      propertyName,
      propertyAddress,
      tenantName,
      inspectionType,
      roomDraft,
      roomTemplates,
      walkthrough,
      pdfUri,
      currentRoomIndex,
      roomPageWidth,
      activeNoteItemId,
      adminUnlocked,
      selectedTemplateId,
    };

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => undefined);
  }, [
    hasHydrated,
    activeTab,
    propertyName,
    propertyAddress,
    tenantName,
    inspectionType,
    roomDraft,
    roomTemplates,
    walkthrough,
    pdfUri,
    currentRoomIndex,
    roomPageWidth,
    activeNoteItemId,
    adminUnlocked,
    selectedTemplateId,
  ]);

  const totalItems = useMemo(
    () => walkthrough?.rooms.reduce((acc, room) => acc + room.items.length, 0) ?? 0,
    [walkthrough],
  );

  const ratedItems = useMemo(
    () =>
      walkthrough?.rooms.reduce(
        (acc, room) => acc + room.items.filter((item) => item.condition !== '').length,
        0,
      ) ?? 0,
    [walkthrough],
  );

  const completedRooms = useMemo(
    () =>
      walkthrough?.rooms.filter((room) => room.items.every((item) => item.condition !== '')).length ?? 0,
    [walkthrough],
  );

  const isWalkthroughComplete = useMemo(() => {
    if (!walkthrough || walkthrough.rooms.length === 0) {
      return false;
    }

    return completedRooms === walkthrough.rooms.length;
  }, [completedRooms, walkthrough]);

  const getMissingRequiredDetailField = (item: ChecklistItem) => {
    const requiredField = item.detailFields.find((field) => field.trim().toLowerCase() === 'type');
    if (!requiredField) {
      return null;
    }

    if (!item.details[requiredField]?.trim()) {
      return requiredField;
    }

    return null;
  };

  const getItemRequirementMessage = (item: ChecklistItem) => {
    const missingRequiredField = getMissingRequiredDetailField(item);
    const noteMissing = (item.condition === 'F' || item.condition === 'P') && !item.note.trim();
    const photoMissing = item.condition === 'P' && getItemPhotoUris(item).length === 0;

    if (missingRequiredField) {
      return `${missingRequiredField} is required.`;
    }

    if (noteMissing && photoMissing) {
      return 'Note and photo are required for Poor condition.';
    }

    if (noteMissing) {
      return 'Note is required for Fair or Poor condition.';
    }

    if (photoMissing) {
      return 'Photo is required for Poor condition.';
    }

    return null;
  };

  const getItemInlineWarningMessage = (item: ChecklistItem) => {
    const missingRequiredField = getMissingRequiredDetailField(item);
    if (missingRequiredField && item.condition !== '') {
      return `${missingRequiredField} is required.`;
    }

    const noteMissing = (item.condition === 'F' || item.condition === 'P') && !item.note.trim();

    if (noteMissing) {
      return 'Note is required for Fair or Poor condition.';
    }

    return null;
  };

  const addRoom = () => {
    const trimmed = roomDraft.trim();
    if (!trimmed) {
      return;
    }

    setRoomTemplates((prev) => [...prev, mkRoom(trimmed.toLowerCase().replace(/\s+/g, '-'), trimmed, [])]);
    setRoomDraft('');
  };

  const addBedroom = () => {
    setRoomTemplates((prev) => {
      const bedroomCount = prev.filter((room) => room.key === 'bedroom').length;
      const name = bedroomCount === 0 ? 'Bedroom' : `Bedroom ${bedroomCount + 1}`;
      return [...prev, mkRoom('bedroom', name, bedroomComponents())];
    });
  };

  const resetToDefaults = () => {
    setRoomTemplates(createDefaultRoomTemplates());
    setWalkthrough(null);
    setPdfUri(null);
    setCurrentRoomIndex(0);
  };

  const removeRoom = (roomId: string) => {
    setRoomTemplates((prev) => prev.filter((room) => room.id !== roomId));
  };

  const cloneRoom = (roomId: string) => {
    let clonedRoomName = '';

    setRoomTemplates((prev) => {
      const source = prev.find((room) => room.id === roomId);
      if (!source) {
        return prev;
      }

      const trimmedName = source.name.trim() || 'Space';
      const suffixMatch = trimmedName.match(/^(.*)\s(\d+)$/);
      const baseName = suffixMatch?.[1]?.trim() || trimmedName;
      const namePattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s(\\d+))?$`);

      const nextNumber =
        prev.reduce((highest, room) => {
          const match = room.name.trim().match(namePattern);
          if (!match) {
            return highest;
          }

          const numericPart = match[1] ? Number(match[1]) : 1;
          return Math.max(highest, numericPart);
        }, 1) + 1;

      const clonedRoom: RoomTemplate = {
        ...source,
        id: generateId(),
        name: `${baseName} ${nextNumber}`,
        componentDraft: '',
        components: source.components.map((component) => ({
          ...component,
          id: generateId(),
        })),
      };
      clonedRoomName = clonedRoom.name;

      return [...prev, clonedRoom];
    });

    if (clonedRoomName) {
      showBanner(`${clonedRoomName} created`);
    }
  };

  const renameRoom = (roomId: string, value: string) => {
    setRoomTemplates((prev) => prev.map((room) => (room.id === roomId ? { ...room, name: value } : room)));
  };

  const updateComponentDraft = (roomId: string, value: string) => {
    setRoomTemplates((prev) =>
      prev.map((room) => (room.id === roomId ? { ...room, componentDraft: value } : room)),
    );
  };

  const addComponentToRoom = (roomId: string) => {
    setRoomTemplates((prev) =>
      prev.map((room) => {
        if (room.id !== roomId) {
          return room;
        }

        const trimmed = room.componentDraft.trim();
        if (!trimmed) {
          return room;
        }

        return {
          ...room,
          componentDraft: '',
          components: [...room.components, mkComponent(trimmed)],
        };
      }),
    );
  };

  const removeComponent = (roomId: string, componentId: string) => {
    setRoomTemplates((prev) =>
      prev.map((room) => {
        if (room.id !== roomId) {
          return room;
        }

        return {
          ...room,
          components: room.components.filter((component) => component.id !== componentId),
        };
      }),
    );
  };

  const startWalkthrough = () => {
    const hasChecklist = roomTemplates.some((room) => room.components.length > 0);
    if (!propertyName.trim() || !hasChecklist) {
      Alert.alert(
        'Missing setup',
        'Add a property name and at least one checklist component before starting.',
      );
      return;
    }

    const rooms: InspectionRoom[] = roomTemplates
      .filter((room) => room.components.length > 0)
      .map((room) => ({
        id: room.id,
        name: room.name.trim() || 'Untitled Space',
        items: room.components.map((component) => ({
          id: generateId(),
          name: component.name,
          detailFields: component.detailFields,
          details: Object.fromEntries(component.detailFields.map((field) => [field, ''])),
          condition: '',
          note: '',
          photoUris: [],
        })),
      }));

    setWalkthrough({
      inspectionType,
      propertyName: propertyName.trim(),
      propertyAddress: propertyAddress.trim(),
      tenantName: tenantName.trim(),
      createdAt: new Date().toISOString(),
      rooms,
    });

    setCurrentRoomIndex(0);
    setRoomPageHeights({});
    setPdfUri(null);
    setActiveTab('Walkthrough');
  };

  const updateItem = (
    roomId: string,
    itemId: string,
    updater: (current: ChecklistItem) => ChecklistItem,
  ) => {
    setWalkthrough((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        rooms: prev.rooms.map((room) => {
          if (room.id !== roomId) {
            return room;
          }

          return {
            ...room,
            items: room.items.map((item) => (item.id === itemId ? updater(item) : item)),
          };
        }),
      };
    });

    setPdfUri(null);
  };

  const toDataUri = async (uri: string) => {
    if (uri.startsWith('data:image/')) {
      return uri;
    }

    if (!uri.startsWith('file://')) {
      return uri;
    }

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64',
    });

    return `data:${guessImageMimeType(uri)};base64,${base64}`;
  };

  const withEmbeddedPhotos = async (source: Walkthrough) => {
    const nextRooms: InspectionRoom[] = [];

    for (const room of source.rooms) {
      const nextItems: ChecklistItem[] = [];

      for (const item of room.items) {
        const photoUris = getItemPhotoUris(item);
        const embeddedPhotoUris: string[] = [];

        for (const photoUri of photoUris) {
          try {
            embeddedPhotoUris.push(await toDataUri(photoUri));
          } catch {
            embeddedPhotoUris.push(photoUri);
          }
        }

        nextItems.push({
          ...item,
          photoUris: embeddedPhotoUris,
          photoUri: undefined,
        });
      }

      nextRooms.push({
        ...room,
        items: nextItems,
      });
    }

    return {
      ...source,
      rooms: nextRooms,
    };
  };

  const markRoomAllGood = (roomId: string, roomName: string) => {
    setWalkthrough((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        rooms: prev.rooms.map((room) => {
          if (room.id !== roomId) {
            return room;
          }

          return {
            ...room,
            items: room.items.map((item) => ({
              ...item,
              condition: 'G',
            })),
          };
        }),
      };
    });

    setActiveNoteItemId(null);
    setPdfUri(null);
    showBanner(`${roomName}: all marked Good`);
  };

  const markAllSpacesDone = () => {
    if (!walkthrough || isWalkthroughComplete) {
      return;
    }

    const lastRoomIndex = Math.max(walkthrough.rooms.length - 1, 0);

    setWalkthrough((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        rooms: prev.rooms.map((room) => ({
          ...room,
          items: room.items.map((item) => ({
            ...item,
            condition: item.condition || 'G',
          })),
        })),
      };
    });

    setActiveNoteItemId(null);
    setPdfUri(null);
    setIsRoomMenuOpen(false);
    moveToRoom(lastRoomIndex);
    showBanner('All spaces marked done');
  };

  const confirmMarkAllSpacesDone = () => {
    if (isWalkthroughComplete) {
      return;
    }

    Alert.alert(
      'Complete walkthrough?',
      'This will mark every remaining item as Good and cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Mark All Done',
          style: 'destructive',
          onPress: markAllSpacesDone,
        },
      ],
    );
  };

  const clearWalkthroughEntries = () => {
    setWalkthrough((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        rooms: prev.rooms.map((room) => ({
          ...room,
          items: room.items.map((item) => ({
            ...item,
            condition: '',
            note: '',
            details: Object.fromEntries(item.detailFields.map((field) => [field, ''])),
            photoUris: [],
            photoUri: undefined,
          })),
        })),
      };
    });

    setActiveNoteItemId(null);
    setPdfUri(null);
    setCurrentRoomIndex(0);
    setIsRoomMenuOpen(false);
    moveToRoom(0);
    showBanner('Walkthrough cleared');
  };

  const confirmClearWalkthroughEntries = () => {
    if (!walkthrough) {
      return;
    }

    Alert.alert(
      'Clear all walkthrough data?',
      'This will remove all ratings, notes, details, and photos for every space. This cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: clearWalkthroughEntries,
        },
      ],
    );
  };

  const pickImageForItem = async (roomId: string, itemId: string) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow camera access to take item photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: false,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    const saveResult = await saveOriginalPhotoToLibrary(asset.uri);

    const lowRes = await manipulateAsync(asset.uri, [], {
      compress: 0.42,
      format: SaveFormat.JPEG,
      base64: true,
    });

    const photoUri = lowRes.base64
      ? `data:image/jpeg;base64,${lowRes.base64}`
      : lowRes.uri;

    updateItem(roomId, itemId, (current) => ({
      ...current,
      photoUris: [...getItemPhotoUris(current), photoUri],
      photoUri: undefined,
    }));

    if (saveResult.saved) {
      showBanner(`Original saved to ${PHOTO_ARCHIVE_ALBUM}`);
    } else if (saveResult.reason === 'permission') {
      showBanner('Photo added. Enable media permission to auto-save originals to phone.');
    } else {
      showBanner('Photo added. Could not save original copy to phone album.');
    }
  };

  const removeItemPhoto = (roomId: string, itemId: string, photoIndex: number) => {
    updateItem(roomId, itemId, (current) => {
      const currentUris = getItemPhotoUris(current);
      return {
        ...current,
        photoUris: currentUris.filter((_, index) => index !== photoIndex),
        photoUri: undefined,
      };
    });
  };

  const handleRoomSwipeEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / roomPageWidth);
    setCurrentRoomIndex(nextIndex);
  };

  const moveToRoom = (index: number) => {
    if (!walkthrough || index < 0 || index >= walkthrough.rooms.length) {
      return;
    }

    pagerRef.current?.scrollTo({ x: index * roomPageWidth, animated: true });
    setCurrentRoomIndex(index);
  };

  const jumpToRoom = (index: number) => {
    moveToRoom(index);
    setIsRoomMenuOpen(false);
  };

  const createPdf = async () => {
    if (!walkthrough) {
      Alert.alert('No walkthrough', 'Start a walkthrough before generating a PDF.');
      return;
    }

    const failingItems: Array<{ roomIndex: number; roomName: string; item: ChecklistItem }> = [];
    walkthrough.rooms.forEach((room, roomIndex) => {
      room.items.forEach((item) => {
        if (getItemRequirementMessage(item)) {
          failingItems.push({ roomIndex, roomName: room.name, item });
        }
      });
    });

    if (failingItems.length > 0) {
      const first = failingItems[0];
      moveToRoom(first.roomIndex);
      setActiveNoteItemId(first.item.id);

      Alert.alert(
        'Missing required details',
        `${first.roomName} - ${first.item.name}: ${getItemRequirementMessage(first.item)}`,
      );
      return;
    }

    const printableWalkthrough = await withEmbeddedPhotos(walkthrough);
    const html = buildPdfHtml(printableWalkthrough);
    const file = await Print.printToFileAsync({ html });
    setPdfUri(file.uri);
    Alert.alert('PDF ready', 'Report generated. You can now save/download or email it.');
  };

  const downloadPdf = async () => {
    if (!pdfUri) {
      Alert.alert('No PDF', 'Generate a PDF first.');
      return;
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Share unavailable', 'Save/download is not available on this device.');
      return;
    }

    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Download or Save Inspection Report',
    });
  };

  const emailPdf = async () => {
    if (!pdfUri || !walkthrough) {
      Alert.alert('No PDF', 'Generate a PDF first.');
      return;
    }

    const available = await MailComposer.isAvailableAsync();
    if (!available) {
      Alert.alert('Mail unavailable', 'Mail composer is not available on this device.');
      return;
    }

    await MailComposer.composeAsync({
      subject: `${walkthrough.inspectionType} report - ${walkthrough.propertyName}`,
      body: 'Attached is the property inspection report.',
      attachments: [pdfUri],
    });
  };

  const smsPdf = async () => {
    if (!pdfUri) {
      Alert.alert('No PDF', 'Generate a PDF first.');
      return;
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Share unavailable', 'Text-message sharing is not available on this device.');
      return;
    }

    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Send PDF via text message',
    });
  };

  const whatsappPdf = async () => {
    if (!pdfUri) {
      Alert.alert('No PDF', 'Generate a PDF first.');
      return;
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Share unavailable', 'WhatsApp sharing is not available on this device.');
      return;
    }

    const hasWhatsApp = await Linking.canOpenURL('whatsapp://send');
    if (!hasWhatsApp) {
      Alert.alert('WhatsApp not found', 'Install WhatsApp to share there, or use Email/SMS.');
      return;
    }

    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share PDF to WhatsApp',
    });
  };

  const openDetailPicker = (roomId: string, itemId: string, field: string, options: string[]) => {
    setSelectMenu({ roomId, itemId, field, options });
  };

  const applyDetailSelection = (option: string) => {
    if (!selectMenu) {
      return;
    }

    updateItem(selectMenu.roomId, selectMenu.itemId, (current) => ({
      ...current,
      details: {
        ...current.details,
        [selectMenu.field]: option,
      },
    }));

    setSelectMenu(null);
  };

  const applySelectedTemplate = () => {
    const template = templateCatalog.properties.find((property) => property.id === selectedTemplateId);
    if (!template) {
      Alert.alert('No template selected', 'Please choose a property template first.');
      return;
    }

    setPropertyName(template.name);
    setPropertyAddress(template.address);
    setRoomTemplates(template.spaces.map((spaceName) => createRoomTemplateFromSpaceName(spaceName)));
    setWalkthrough(null);
    setPdfUri(null);
    setCurrentRoomIndex(0);
    setActiveNoteItemId(null);
    showBanner(`${template.name} template loaded`);
  };

  const renderAdminTab = () => (
    !adminUnlocked ? (
      <View style={styles.emptyStateWrap}>
        <Text style={styles.emptyStateTitle}>Admin Locked</Text>
        <Text style={styles.emptyStateText}>
          Enter admin password to edit property setup. Walkthrough tab remains open.
        </Text>
        <TextInput
          value={adminPasswordInput}
          onChangeText={(value) => {
            setAdminPasswordInput(value);
            if (adminAuthError) {
              setAdminAuthError(null);
            }
          }}
          placeholder="Admin password"
          placeholderTextColor="#7a8da8"
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        {adminAuthError ? <Text style={styles.authErrorText}>{adminAuthError}</Text> : null}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            if (adminPasswordInput === ADMIN_PASSWORD) {
              setAdminUnlocked(true);
              setAdminPasswordInput('');
              setAdminAuthError(null);
              showBanner('Admin unlocked');
              return;
            }

            setAdminAuthError('Incorrect password');
          }}
        >
          <Text style={styles.primaryButtonText}>Unlock Admin</Text>
        </TouchableOpacity>
      </View>
    ) : (
    <ScrollView contentContainerStyle={[styles.contentContainer, { paddingBottom: bottomSafePadding }]}> 
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Admin</Text>
        <Text style={styles.heroSubtitle}>Default spaces are preloaded. Add bedrooms, duplicate spaces, or rename any space.</Text>
      </View>

      <View style={styles.rowWrap}>
        <TouchableOpacity
          style={styles.secondaryButtonSmall}
          onPress={() => {
            setAdminUnlocked(false);
            setAdminPasswordInput('');
            setAdminAuthError(null);
            showBanner('Admin locked');
          }}
        >
          <Text style={styles.secondaryButtonText}>Lock Admin</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Saved Property Templates</Text>
        <Text style={styles.metaLine}>
          Select a template from property-templates.json and load it into setup.
        </Text>

        <View style={styles.rowWrap}>
          {templateCatalog.properties.map((property) => {
            const selected = selectedTemplateId === property.id;
            return (
              <TouchableOpacity
                key={property.id}
                style={[
                  styles.pill,
                  selected ? styles.pillActive : styles.pillInactive,
                ]}
                onPress={() => setSelectedTemplateId(property.id)}
              >
                <Text
                  style={[
                    styles.pillText,
                    selected ? styles.pillTextActive : styles.pillTextInactive,
                  ]}
                >
                  {property.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.addButton} onPress={applySelectedTemplate}>
          <Text style={styles.addButtonText}>Load Selected Template</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Property Profile</Text>
        <TextInput
          value={propertyName}
          onChangeText={setPropertyName}
          placeholder="Property name"
          placeholderTextColor="#7a8da8"
          style={styles.input}
        />
        <TextInput
          value={propertyAddress}
          onChangeText={setPropertyAddress}
          placeholder="Property address"
          placeholderTextColor="#7a8da8"
          style={styles.input}
        />
        <TextInput
          value={tenantName}
          onChangeText={setTenantName}
          placeholder="Tenant name (optional)"
          placeholderTextColor="#7a8da8"
          style={styles.input}
        />

        <Text style={styles.label}>Inspection Type</Text>
        <View style={styles.rowWrap}>
          {(['Move-In', 'Move-Out', 'Routine'] as InspectionType[]).map((type) => (
            <TouchableOpacity
              key={type}
              style={[
                styles.pill,
                inspectionType === type ? styles.pillActive : styles.pillInactive,
              ]}
              onPress={() => setInspectionType(type)}
            >
              <Text
                style={[
                  styles.pillText,
                  inspectionType === type ? styles.pillTextActive : styles.pillTextInactive,
                ]}
              >
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Spaces and Checklist Components</Text>

        <View style={styles.rowWrap}>
          <TouchableOpacity style={styles.addButton} onPress={addBedroom}>
            <Text style={styles.addButtonText}>Add Bedroom</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButtonSmall} onPress={resetToDefaults}>
            <Text style={styles.secondaryButtonText}>Reset Defaults</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inlineInputRow}>
          <TextInput
            value={roomDraft}
            onChangeText={setRoomDraft}
            placeholder="Add custom space"
            placeholderTextColor="#7a8da8"
            style={[styles.input, styles.inlineInput]}
          />
          <TouchableOpacity style={styles.addButton} onPress={addRoom}>
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        {roomTemplates.map((room) => (
          <View key={room.id} style={styles.spaceCard}>
            <View style={styles.spaceHeader}>
              <TextInput
                value={room.name}
                onChangeText={(value) => renameRoom(room.id, value)}
                multiline
                scrollEnabled={false}
                style={styles.spaceTitleInput}
              />

              <View style={styles.spaceHeaderActions}>
                <TouchableOpacity onPress={() => cloneRoom(room.id)}>
                  <Text style={styles.cloneText}>Clone</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeRoom(room.id)}>
                  <Text style={styles.removeText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inlineInputRow}>
              <TextInput
                value={room.componentDraft}
                onChangeText={(value) => updateComponentDraft(room.id, value)}
                placeholder="Add custom component"
                placeholderTextColor="#7a8da8"
                style={[styles.input, styles.inlineInput]}
              />
              <TouchableOpacity style={styles.addButton} onPress={() => addComponentToRoom(room.id)}>
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.componentList}>
              {room.components.map((component) => (
                <View key={component.id} style={styles.componentRow}>
                  <View style={styles.componentTextWrap}>
                    <Text style={styles.componentName}>{component.name}</Text>
                    {component.detailFields.length > 0 ? (
                      <Text style={styles.componentDetailText}>
                        Fields: {component.detailFields.join(', ')}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={() => removeComponent(room.id, component.id)}>
                    <Text style={styles.removeText}>x</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.primaryButton} onPress={startWalkthrough}>
          <Text style={styles.primaryButtonText}>Start Walkthrough</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    )
  );

  const renderWalkthroughTab = () => {
    if (!walkthrough) {
      return (
        <View style={styles.emptyStateWrap}>
          <Text style={styles.emptyStateTitle}>No active walkthrough</Text>
          <Text style={styles.emptyStateText}>
            Go to Admin, confirm spaces and checklist setup, then start walkthrough.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setActiveTab('Admin')}>
            <Text style={styles.primaryButtonText}>Go to Admin</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const isLastRoom = currentRoomIndex === walkthrough.rooms.length - 1;
    const currentRoomName = walkthrough.rooms[currentRoomIndex]?.name || 'Room';
    const currentRoomId = walkthrough.rooms[currentRoomIndex]?.id;
    const currentRoomHeight = currentRoomId ? roomPageHeights[currentRoomId] : undefined;

    return (
      <ScrollView contentContainerStyle={[styles.contentContainer, { paddingBottom: bottomSafePadding }]}> 
        <View style={styles.walkthroughSummaryCard}>
          <View style={styles.walkthroughSummaryTop}>
            <Text style={styles.walkthroughSummaryName} numberOfLines={1}>
              {walkthrough.propertyName}
            </Text>
            <View style={styles.walkthroughSummaryPills}>
              <View style={styles.walkthroughTypePill}>
                <Text style={styles.walkthroughTypePillText}>{walkthrough.inspectionType}</Text>
              </View>
              <View style={styles.walkthroughProgressPill}>
                <Text style={styles.walkthroughProgressPillText}>{ratedItems}/{totalItems}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.walkthroughSummaryMeta} numberOfLines={1}>
            {[walkthrough.propertyAddress, walkthrough.tenantName ? `Tenant: ${walkthrough.tenantName}` : null]
              .filter(Boolean).join(' · ') || 'No address on file'}
          </Text>
          <View style={styles.walkthroughActionsRow}>
            <TouchableOpacity
              style={styles.walkthroughCompleteRow}
              onPress={confirmMarkAllSpacesDone}
              activeOpacity={0.85}
            >
              <View
                style={[
                  styles.walkthroughCompleteCheckbox,
                  isWalkthroughComplete ? styles.walkthroughCompleteCheckboxChecked : undefined,
                ]}
              >
                {isWalkthroughComplete ? <Text style={styles.walkthroughCompleteCheckmark}>✓</Text> : null}
              </View>
              <Text style={styles.walkthroughCompleteTitle}>
                Done ({completedRooms}/{walkthrough.rooms.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.walkthroughClearButton}
              onPress={confirmClearWalkthroughEntries}
              activeOpacity={0.85}
            >
              <Text style={styles.walkthroughClearButtonText}>Clear All</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.roomNavRow}>
            <TouchableOpacity
              style={[styles.navButton, currentRoomIndex === 0 ? styles.navDisabled : undefined]}
              onPress={() => moveToRoom(currentRoomIndex - 1)}
              disabled={currentRoomIndex === 0}
            >
              <Text style={styles.navButtonText}>Previous</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.roomPickerButton}
              onPress={() => setIsRoomMenuOpen((prev) => !prev)}
            >
              <Text style={styles.roomPickerButtonText}>
                Room {currentRoomIndex + 1}/{walkthrough.rooms.length}
              </Text>
              <Text style={styles.roomPickerArrow}>{isRoomMenuOpen ? '▴' : '▾'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.navButton,
                currentRoomIndex === walkthrough.rooms.length - 1 ? styles.navDisabled : undefined,
              ]}
              onPress={() => moveToRoom(currentRoomIndex + 1)}
              disabled={currentRoomIndex === walkthrough.rooms.length - 1}
            >
              <Text style={styles.navButtonText}>Next</Text>
            </TouchableOpacity>
          </View>

          {isRoomMenuOpen ? (
            <View style={styles.roomPickerList}>
              <Text style={styles.roomPickerCurrent}>Current: {currentRoomName}</Text>
              {walkthrough.rooms.map((room, index) => {
                const selected = index === currentRoomIndex;
                return (
                  <TouchableOpacity
                    key={room.id}
                    style={[
                      styles.roomPickerListItem,
                      selected ? styles.roomPickerListItemSelected : undefined,
                    ]}
                    onPress={() => jumpToRoom(index)}
                  >
                    <Text
                      style={[
                        styles.roomPickerListItemText,
                        selected ? styles.roomPickerListItemTextSelected : undefined,
                      ]}
                    >
                      Room {index + 1}: {room.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            onLayout={(event) => {
              const width = Math.ceil(event.nativeEvent.layout.width);
              if (width > 0 && width !== roomPageWidth) {
                setRoomPageWidth(width);
              }
            }}
            onMomentumScrollEnd={handleRoomSwipeEnd}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.roomPagerContent}
            style={currentRoomHeight ? { height: currentRoomHeight } : undefined}
          >
            {walkthrough.rooms.map((room) => (
              <View
                key={room.id}
                style={[styles.roomPage, { width: roomPageWidth }]}
                onLayout={(event) => {
                  const nextHeight = Math.ceil(event.nativeEvent.layout.height);
                  setRoomPageHeights((prev) => {
                    if (prev[room.id] === nextHeight) {
                      return prev;
                    }

                    return {
                      ...prev,
                      [room.id]: nextHeight,
                    };
                  });
                }}
              >
                <View style={styles.roomTitleRow}>
                  <Text style={styles.roomTitle}>{room.name}</Text>
                  <TouchableOpacity
                    style={styles.markAllGoodButton}
                    onPress={() => markRoomAllGood(room.id, room.name)}
                  >
                    <Text style={styles.markAllGoodButtonText}>Mark All Good</Text>
                  </TouchableOpacity>
                </View>
                {room.items.map((item) => (
                  <View key={item.id} style={styles.itemCard}>
                    {(() => {
                      const isEditingNote = activeNoteItemId === item.id;
                      const requirementMessage = getItemInlineWarningMessage(item);

                      return (
                        <>
                    <View style={styles.itemHeaderRow}>
                      <Text style={styles.itemTitle}>{item.name}</Text>

                      <View style={styles.itemDetailsInlineRow}>
                        {item.detailFields.map((field) => {
                          const options = getDetailOptions(item.name, field);
                          if (options) {
                            return (
                              <TouchableOpacity
                                key={`${item.id}-${field}`}
                                style={styles.itemDetailSelectButton}
                                onPress={() => openDetailPicker(room.id, item.id, field, options)}
                              >
                                <Text
                                  style={
                                    item.details[field]?.trim()
                                      ? styles.itemDetailSelectValue
                                      : styles.itemDetailSelectPlaceholder
                                  }
                                >
                                  {item.details[field]?.trim() || field}
                                </Text>
                                <Text style={styles.itemDetailSelectArrow}>▾</Text>
                              </TouchableOpacity>
                            );
                          }

                          return (
                            <TextInput
                              key={`${item.id}-${field}`}
                              value={item.details[field] ?? ''}
                              onChangeText={(value) =>
                                updateItem(room.id, item.id, (current) => ({
                                  ...current,
                                  details: {
                                    ...current.details,
                                    [field]: value,
                                  },
                                }))
                              }
                              placeholder={field}
                              placeholderTextColor="#7a8da8"
                              style={styles.itemDetailInlineInput}
                            />
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.itemActionRow}>
                      <View style={styles.gfpInlineRow}>
                        {conditions.map((condition) => {
                          const selected = item.condition === condition;
                          const conditionLabel =
                            condition === 'G' ? 'Good' : condition === 'F' ? 'Fair' : 'Poor';
                          const toneStyle =
                            condition === 'G'
                              ? styles.conditionGood
                              : condition === 'F'
                                ? styles.conditionFair
                                : styles.conditionPoor;
                          const dotStyle =
                            condition === 'G'
                              ? styles.conditionDotGood
                              : condition === 'F'
                                ? styles.conditionDotFair
                                : styles.conditionDotPoor;
                          const dotSelectedStyle =
                            condition === 'G'
                              ? styles.conditionDotGoodSelected
                              : condition === 'F'
                                ? styles.conditionDotFairSelected
                                : styles.conditionDotPoorSelected;

                          return (
                            <TouchableOpacity
                              key={`${item.id}-${condition}`}
                              style={[
                                styles.conditionButtonCompact,
                                toneStyle,
                                selected ? styles.conditionButtonCompactSelected : undefined,
                              ]}
                              onPress={() => {
                                updateItem(room.id, item.id, (current) => ({ ...current, condition }));
                                if (condition === 'F' || condition === 'P') {
                                  setActiveNoteItemId(item.id);
                                }
                              }}
                            >
                              <View
                                style={[
                                  styles.conditionDot,
                                  dotStyle,
                                  selected ? dotSelectedStyle : undefined,
                                ]}
                              />
                              <Text
                                style={[
                                  styles.conditionTextCompact,
                                  selected ? styles.conditionTextSelected : styles.conditionTextNeutral,
                                ]}
                              >
                                {conditionLabel}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <View style={styles.rightIconRow}>
                        <TouchableOpacity
                          style={styles.inlineActionButton}
                          onPress={() =>
                            setActiveNoteItemId((prev) => (prev === item.id ? null : item.id))
                          }
                        >
                          <Text style={[styles.inlineActionButtonText, styles.editActionButtonText]}>✎</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.inlineActionButton}
                          onPress={() => pickImageForItem(room.id, item.id)}
                        >
                          <Text style={styles.inlineActionButtonText}>📷</Text>
                        </TouchableOpacity>

                        {getItemPhotoUris(item).length > 0 ? (
                          <TouchableOpacity
                            style={styles.clearButtonCompact}
                            onPress={() =>
                              updateItem(room.id, item.id, (current) => ({
                                ...current,
                                photoUris: [],
                                photoUri: undefined,
                              }))
                            }
                          >
                            <Text style={styles.clearButtonText}>Clear All</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>

                    {isEditingNote ? (
                      <TextInput
                        value={item.note}
                        onChangeText={(value) =>
                          updateItem(room.id, item.id, (current) => ({ ...current, note: value }))
                        }
                        placeholder="Notes"
                        placeholderTextColor="#7a8da8"
                        style={styles.notesInput}
                        multiline
                        textAlignVertical="top"
                        autoFocus
                        onBlur={() => setActiveNoteItemId(null)}
                      />
                    ) : item.note.trim().length > 0 ? (
                      <Text style={styles.notePreviewText}>{item.note}</Text>
                    ) : null}

                    {requirementMessage ? (
                      <Text style={styles.requirementWarningText}>{requirementMessage}</Text>
                    ) : null}

                    {getItemPhotoUris(item).length > 0 ? (
                      <View style={styles.photoGalleryWrap}>
                        {getItemPhotoUris(item).map((uri, photoIndex) => (
                          <View key={`${item.id}-photo-${photoIndex}`} style={styles.photoThumbWrap}>
                            <Image source={{ uri }} style={styles.photoThumb} />
                            <TouchableOpacity
                              style={styles.photoDeleteBadge}
                              onPress={() => removeItemPhoto(room.id, item.id, photoIndex)}
                            >
                              <Text style={styles.photoDeleteBadgeText}>×</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    ) : null}
                        </>
                      );
                    })()}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>

        {isLastRoom ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Finish and Share</Text>

            <TouchableOpacity style={styles.primaryButton} onPress={createPdf}>
              <Text style={styles.primaryButtonText}>Generate PDF</Text>
            </TouchableOpacity>

            <View style={styles.quickShareRow}>
              <TouchableOpacity style={styles.quickShareButton} onPress={downloadPdf}>
                <Text style={styles.quickShareIcon}>⇩</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickShareButton} onPress={emailPdf}>
                <Text style={styles.quickShareIcon}>✉</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickShareButton} onPress={smsPdf}>
                <Text style={styles.quickShareIcon}>💬</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickShareButton} onPress={whatsappPdf}>
                <Image source={whatsappLogo} style={styles.quickShareLogoImage} resizeMode="contain" />
              </TouchableOpacity>
            </View>

            {pdfUri ? <Text style={styles.pdfReady}>PDF generated and ready to share.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <View style={styles.headerLogoWrap}>
          <Image source={headerLogo} style={styles.headerLogo} resizeMode="contain" />
        </View>
        <Text style={styles.appSubTitle}>Property condition checklist</Text>
      </View>

      <View style={styles.tabStrip}>
        {(['Admin', 'Walkthrough'] as AppTab[]).map((tab) => {
          const selected = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, selected ? styles.tabButtonActive : styles.tabButtonInactive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, selected ? styles.tabTextActive : styles.tabTextInactive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selectMenu ? (
        <View style={styles.selectMenuOverlay}>
          <View style={styles.selectMenuCard}>
            <Text style={styles.selectMenuTitle}>Select {selectMenu.field}</Text>
            <ScrollView style={styles.selectMenuList}>
              {selectMenu.options.map((option) => (
                <TouchableOpacity
                  key={`${selectMenu.field}-${option}`}
                  style={styles.selectMenuOption}
                  onPress={() => applyDetailSelection(option)}
                >
                  <Text style={styles.selectMenuOptionText}>{option}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.selectMenuCancel} onPress={() => setSelectMenu(null)}>
              <Text style={styles.selectMenuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {activeTab === 'Admin' ? renderAdminTab() : renderWalkthroughTab()}

      {bannerMessage ? (
        <Animated.View
          style={[styles.toastOverlay, { opacity: bannerOpacity, bottom: Platform.OS === 'android' ? 38 : 12 }]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{bannerMessage}</Text>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  headerLogoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  headerLogo: {
    width: 84,
    height: 54,
  },
  appSubTitle: {
    color: '#eceef1',
    fontSize: 13,
    marginTop: 2,
    textAlign: 'center',
  },
  tabStrip: {
    flexDirection: 'row',
    backgroundColor: '#e3e4e7',
    margin: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c9cbd0',
    padding: 4,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
  },
  tabButtonInactive: {
    backgroundColor: '#e3e4e7',
  },
  toastOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    backgroundColor: '#eaf8ef',
    borderWidth: 1,
    borderColor: '#a8d9b8',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    zIndex: 20,
  },
  toastText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.primary,
  },
  tabTextInactive: {
    color: colors.muted,
  },
  selectMenuOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(11, 31, 63, 0.34)',
    justifyContent: 'center',
    paddingHorizontal: 20,
    zIndex: 50,
  },
  selectMenuCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    maxHeight: '70%',
    gap: 8,
  },
  selectMenuTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  selectMenuList: {
    maxHeight: 300,
  },
  selectMenuOption: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d6e0ee',
    backgroundColor: '#f8fbff',
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 7,
  },
  selectMenuOptionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  selectMenuCancel: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  selectMenuCancelText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  contentContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
      gap: 10,
  },
  hero: {
    backgroundColor: colors.primaryDeep,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#5b6067',
    padding: 14,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#d8dce2',
    marginTop: 4,
    fontSize: 13,
  },
    walkthroughSummaryCard: {
      backgroundColor: colors.panel,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      padding: 12,
      gap: 7,
    },
    walkthroughSummaryTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    walkthroughSummaryName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
      flex: 1,
    },
    walkthroughSummaryPills: {
      flexDirection: 'row',
      gap: 5,
      flexShrink: 0,
    },
    walkthroughTypePill: {
      backgroundColor: '#fbeef0',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: '#e2b0b7',
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    walkthroughTypePillText: {
      color: colors.danger,
      fontSize: 10,
      fontWeight: '800',
    },
    walkthroughProgressPill: {
      backgroundColor: '#e6effb',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: '#bdd1e9',
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    walkthroughProgressPillText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '800',
    },
    walkthroughSummaryMeta: {
      color: colors.muted,
      fontSize: 12,
    },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.fieldBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  inlineInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineInput: {
    flex: 1,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillActive: {
    backgroundColor: '#ececef',
    borderColor: '#a7acb6',
  },
  pillInactive: {
    backgroundColor: '#f8f8f9',
    borderColor: '#d7d8dc',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pillTextActive: {
    color: colors.primary,
  },
  pillTextInactive: {
    color: colors.muted,
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  addButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  secondaryButtonSmall: {
    backgroundColor: '#ededf0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#c8cad1',
  },
  quickShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  quickShareButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c1c6d0',
    backgroundColor: '#f2f4f8',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  quickShareIcon: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '900',
  },
  quickShareLogoImage: {
    width: 28,
    height: 28,
    borderRadius: 7,
  },
  spaceCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fbff',
    padding: 8,
    gap: 8,
  },
  spaceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  spaceHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  spaceTitleInput: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    borderBottomWidth: 1,
    borderBottomColor: '#ccd9ea',
    paddingBottom: 3,
  },
  cloneText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  removeText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  componentList: {
    gap: 6,
  },
  componentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d5e2f1',
    backgroundColor: '#ffffff',
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  componentTextWrap: {
    flex: 1,
  },
  componentName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  componentDetailText: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  primaryButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyStateWrap: {
    margin: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  emptyStateTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyStateText: {
    color: colors.muted,
    lineHeight: 20,
  },
  authErrorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  metaLine: {
    color: colors.muted,
    fontSize: 13,
  },
  walkthroughActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  walkthroughCompleteRow: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c8cdd5',
    backgroundColor: '#f3f5f8',
      paddingVertical: 7,
      paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  walkthroughCompleteCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#9da4b0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkthroughCompleteCheckboxChecked: {
    borderColor: '#7d1f2a',
    backgroundColor: '#7d1f2a',
  },
  walkthroughCompleteCheckmark: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 12,
    lineHeight: 12,
  },
  walkthroughCompleteCopy: {
    flex: 1,
    gap: 2,
  },
  walkthroughCompleteTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  walkthroughCompleteMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  walkthroughClearButton: {
    minWidth: 82,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2b0b7',
    backgroundColor: '#fbeef0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  walkthroughClearButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  roomNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomCounter: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  roomPickerButton: {
    minWidth: 130,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c8ccd3',
    backgroundColor: '#f7f8fa',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  roomPickerButtonText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
  },
  roomPickerArrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  roomPickerList: {
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d4d7dd',
    backgroundColor: '#f8f9fb',
    padding: 8,
    gap: 6,
  },
  roomPickerCurrent: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
    width: '100%',
    flexShrink: 1,
  },
  roomPickerListItem: {
    width: '100%',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#d8dade',
    backgroundColor: '#ffffff',
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  roomPickerListItemSelected: {
    borderColor: '#a8adb7',
    backgroundColor: '#eceef2',
  },
  roomPickerListItemText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    width: '100%',
    maxWidth: '100%',
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  roomPickerListItemTextSelected: {
    color: colors.primary,
    fontWeight: '800',
  },
  navButton: {
    backgroundColor: '#eceef2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c7ccd4',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  navButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  navDisabled: {
    opacity: 0.4,
  },
  roomPage: {
    gap: 10,
    paddingRight: 12,
    paddingBottom: 2,
    paddingTop: 2,
  },
  roomPagerContent: {
    alignItems: 'flex-start',
  },
  roomTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
    maxWidth: '100%',
    flexWrap: 'wrap',
  },
  roomTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  markAllGoodButton: {
    flexShrink: 0,
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7ac398',
    backgroundColor: '#e6f7ee',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  markAllGoodButtonText: {
    color: '#0c8f46',
    fontSize: 11,
    fontWeight: '800',
  },
  itemCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fdfefe',
      padding: 7,
      gap: 5,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemDetailsInlineRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  itemDetailInlineInput: {
    minWidth: 62,
    maxWidth: 84,
    backgroundColor: colors.fieldBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    color: colors.text,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 11,
  },
  itemDetailSelectButton: {
    minWidth: 74,
    maxWidth: 108,
    backgroundColor: colors.fieldBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  itemDetailSelectPlaceholder: {
    color: colors.muted,
    fontSize: 11,
    flexShrink: 1,
  },
  itemDetailSelectValue: {
    color: colors.text,
    fontSize: 11,
    flexShrink: 1,
  },
  itemDetailSelectArrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  itemTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    flexShrink: 1,
  },
  conditionButton: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  conditionButtonCompact: {
    borderRadius: 4,
    borderWidth: 1,
    width: 60,
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  conditionButtonCompactSelected: {
    borderWidth: 2,
    shadowColor: '#1f2937',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 2,
  },
  conditionDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#ffffff',
  },
  conditionDotGood: {
    borderColor: '#0c8f46',
  },
  conditionDotGoodSelected: {
    backgroundColor: '#0c8f46',
  },
  conditionDotFair: {
    borderColor: '#cf6a00',
  },
  conditionDotFairSelected: {
    backgroundColor: '#cf6a00',
  },
  conditionDotPoor: {
    borderColor: '#cb2b2b',
  },
  conditionDotPoorSelected: {
    backgroundColor: '#cb2b2b',
  },
  notesInput: {
    backgroundColor: colors.fieldBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    color: colors.text,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    minHeight: 72,
    marginTop: 6,
  },
  notePreviewText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
  },
  requirementWarningText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  itemActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'space-between',
  },
  gfpInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rightIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineActionButton: {
    width: 28,
    height: 28,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#bdd1e9',
    backgroundColor: '#e6effb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineActionButtonText: {
    fontSize: 11,
    lineHeight: 11,
    color: colors.primary,
  },
  editActionButtonText: {
    transform: [{ scaleX: -1 }],
  },
  clearButtonCompact: {
    backgroundColor: '#fdecec',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#f5bdbd',
    alignItems: 'center',
  },
  conditionNeutral: {
    borderColor: '#ccd8e8',
    backgroundColor: '#f8fbff',
  },
  conditionGood: {
    borderColor: '#7ac398',
    backgroundColor: '#e6f7ee',
  },
  conditionFair: {
    borderColor: '#edb066',
    backgroundColor: '#fff2e1',
  },
  conditionPoor: {
    borderColor: '#ea8f8f',
    backgroundColor: '#ffe8e8',
  },
  conditionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  conditionTextSelected: {
    color: '#12315a',
  },
  conditionTextNeutral: {
    color: colors.muted,
  },
  conditionTextCompact: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0,
  },
  secondaryButtonMedium: {
    backgroundColor: '#e6effb',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#bdd1e9',
    alignItems: 'center',
  },
  secondaryButtonLarge: {
    backgroundColor: '#e6effb',
    borderRadius: 10,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#bdd1e9',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  clearButton: {
    backgroundColor: '#fdecec',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#f5bdbd',
    alignItems: 'center',
  },
  clearButtonText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
  photoGalleryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoThumbWrap: {
    width: 86,
    height: 86,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c3d3e8',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#ffffff',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoDeleteBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(127, 27, 36, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDeleteBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 14,
  },
  pdfReady: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
});
