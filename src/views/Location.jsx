import { useState, useEffect, useRef, useCallback } from "react";
import {
  MapPinIcon,
  HomeIcon,
  BriefcaseIcon,
  SparklesIcon,
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import toast from "react-hot-toast";
import LocationSkeleton from "../components/skeletons/LocationSkeleton";

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const STORAGE_KEY = "fairsynq_saved_addresses";
const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 }; // Geographic center of USA as fallback

// ─── Address labels ────────────────────────────────────────────────────────────

const LABELS = [
  { id: "Home", icon: HomeIcon, emoji: "🏠" },
  { id: "Work", icon: BriefcaseIcon, emoji: "💼" },
  { id: "Event", icon: SparklesIcon, emoji: "🎪" },
  { id: "Other", icon: EllipsisHorizontalIcon, emoji: "📍" },
];

const getLabelEmoji = (label) => LABELS.find((l) => l.id === label)?.emoji || "📍";

// ─── Dark map styles ───────────────────────────────────────────────────────────

const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a1a1a1" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f0f0f" }] },
  { featureType: "administrative.land_parcel", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels.text", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#242424" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2e2e2e" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#383838" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#444444" }] },
  { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1a2e" }] },
];

// ─── Custom map pin component ──────────────────────────────────────────────────

const PinkPin = () => (
  <div className="relative">
    <div className="w-8 h-8 rounded-full bg-neon-pink border-2 border-white shadow-[0_0_12px_rgba(255,0,119,0.6)] flex items-center justify-center">
      <MapPinIcon className="w-4 h-4 text-white" />
    </div>
    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-neon-pink" />
  </div>
);

// ─── Geocoding hook ────────────────────────────────────────────────────────────

const useGeocoder = () => {
  const geocodingLib = useMapsLibrary("geocoding");
  const geocoderRef = useRef(null);

  useEffect(() => {
    if (geocodingLib && !geocoderRef.current) {
      geocoderRef.current = new geocodingLib.Geocoder();
    }
  }, [geocodingLib]);

  const reverseGeocode = useCallback(async (lat, lng) => {
    if (!geocoderRef.current) return null;
    try {
      const result = await geocoderRef.current.geocode({ location: { lat, lng } });
      const components = result.results[0]?.address_components || [];
      const get = (type) =>
        components.find((c) => c.types.includes(type))?.long_name || "";
      const getShort = (type) =>
        components.find((c) => c.types.includes(type))?.short_name || "";

      return {
        fullAddress: result.results[0]?.formatted_address || "",
        street: `${get("street_number")} ${get("route")}`.trim(),
        city: get("locality") || get("administrative_area_level_2"),
        state: getShort("administrative_area_level_1"),
        zip: get("postal_code"),
        lat,
        lng,
      };
    } catch {
      return null;
    }
  }, []);

  return { reverseGeocode };
};

// ─── Autocomplete search inside the APIProvider ────────────────────────────────

const AddressSearchInput = ({ onPlaceSelect }) => {
  const placesLib = useMapsLibrary("places");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;
    const autocomplete = new placesLib.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      fields: ["geometry", "formatted_address", "address_components"],
      types: ["address"],
    });
    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place.geometry?.location) return;
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const components = place.address_components || [];
      const get = (type) =>
        components.find((c) => c.types.includes(type))?.long_name || "";
      const getShort = (type) =>
        components.find((c) => c.types.includes(type))?.short_name || "";

      onPlaceSelect({
        fullAddress: place.formatted_address || "",
        street: `${get("street_number")} ${get("route")}`.trim(),
        city: get("locality") || get("administrative_area_level_2"),
        state: getShort("administrative_area_level_1"),
        zip: get("postal_code"),
        lat,
        lng,
      });
    });
    return () => window.google?.maps?.event?.clearInstanceListeners(autocomplete);
  }, [placesLib]);

  return (
    <div className="relative">
      <MagnifyingGlassIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-text-gray pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search for a delivery address…"
        className="w-full py-3.5 pl-12 pr-4 bg-bg-dark border border-white/10 rounded-xl text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink focus:shadow-glow"
      />
    </div>
  );
};

// ─── Interactive map inner component (must be inside APIProvider) ──────────────

const LocationMap = ({ position, onMapClick, onDragEnd, loading }) => {
  const map = useMap();
  const { reverseGeocode } = useGeocoder();

  // Pan map to new position
  useEffect(() => {
    if (map && position) map.panTo(position);
  }, [map, position?.lat, position?.lng]);

  const handleMarkerDragEnd = useCallback(
    async (e) => {
      const lat = e.latLng?.lat();
      const lng = e.latLng?.lng();
      if (lat == null || lng == null) return;
      const addr = await reverseGeocode(lat, lng);
      onDragEnd({ lat, lng, ...(addr || {}) });
    },
    [reverseGeocode, onDragEnd]
  );

  const handleMapClick = useCallback(
    async (e) => {
      const lat = e.detail?.latLng?.lat;
      const lng = e.detail?.latLng?.lng;
      if (lat == null || lng == null) return;
      const addr = await reverseGeocode(lat, lng);
      onMapClick({ lat, lng, ...(addr || {}) });
    },
    [reverseGeocode, onMapClick]
  );

  return (
    <>
      <Map
        mapId="location-map"
        defaultCenter={position || DEFAULT_CENTER}
        defaultZoom={15}
        gestureHandling="greedy"
        disableDefaultUI={false}
        zoomControl={true}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
        onClick={handleMapClick}
        defaultOptions={{ styles: DARK_MAP_STYLES }}
        className="w-full h-full"
      >
        {position && (
          <AdvancedMarker
            position={position}
            draggable
            onDragEnd={handleMarkerDragEnd}
          >
            <PinkPin />
          </AdvancedMarker>
        )}
      </Map>

      {/* Overlay controls */}
      {loading && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none">
          <div className="w-6 h-6 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-sm text-text-gray text-[0.625rem] px-2.5 py-1.5 rounded-full border border-white/10">
        Drag the pin or tap to reposition
      </div>
    </>
  );
};

// ─── Saved address card ────────────────────────────────────────────────────────

const SavedAddressCard = ({ address, onSelect, onDelete }) => (
  <div className="bg-bg-card border border-white/5 rounded-xl p-4 flex items-center gap-3 hover:border-neon-pink/20 transition-all duration-200 group">
    <button
      onClick={() => onSelect(address)}
      className="flex items-center gap-3 flex-1 text-left bg-transparent border-0 cursor-pointer p-0"
    >
      <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 text-base group-hover:bg-neon-pink/10 transition-colors duration-200">
        {getLabelEmoji(address.label)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium">{address.label}</p>
        <p className="text-text-gray text-xs truncate">{address.fullAddress || `${address.street}, ${address.city}`}</p>
        {address.instructions && (
          <p className="text-text-gray/60 text-[0.625rem] truncate mt-0.5 italic">{address.instructions}</p>
        )}
      </div>
    </button>
    <button
      onClick={() => onDelete(address.id)}
      className="p-1.5 text-text-gray hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200 flex-shrink-0 bg-transparent border-0 cursor-pointer"
      aria-label="Delete address"
    >
      <TrashIcon className="w-4 h-4" />
    </button>
  </div>
);

// ─── Main page ─────────────────────────────────────────────────────────────────

const LocationInner = () => {
  const [geoLoading, setGeoLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(false);
  const [position, setPosition] = useState(null);
  const [formData, setFormData] = useState({
    street: "", apt: "", city: "", state: "", zip: "", label: "Home", instructions: "",
  });
  const [fullAddress, setFullAddress] = useState("");
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [activeAddress, setActiveAddress] = useState(null);

  // Load saved addresses from localStorage
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setSavedAddresses(Array.isArray(stored) ? stored : []);
      const active = JSON.parse(localStorage.getItem(`${STORAGE_KEY}_active`) || "null");
      if (active) setActiveAddress(active);
    } catch {}
  }, []);

  // Get current location on mount
  useEffect(() => {
    if (!navigator.geolocation) { setGeoLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      () => { setGeoLoading(false); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const applyAddressData = useCallback((data) => {
    setPosition({ lat: data.lat, lng: data.lng });
    setFullAddress(data.fullAddress || "");
    setFormData((prev) => ({
      ...prev,
      street: data.street || "",
      city: data.city || "",
      state: data.state || "",
      zip: data.zip || "",
    }));
  }, []);

  const handleSave = () => {
    if (!formData.street || !formData.city) {
      toast.error("Please enter a street address and city.");
      return;
    }

    const newAddress = {
      id: Date.now().toString(),
      ...formData,
      fullAddress,
      lat: position?.lat,
      lng: position?.lng,
    };

    const updated = [...savedAddresses, newAddress];
    setSavedAddresses(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    localStorage.setItem(`${STORAGE_KEY}_active`, JSON.stringify(newAddress));
    setActiveAddress(newAddress);
    toast.success(`"${formData.label}" address saved! ✅`);
  };

  const handleConfirm = () => {
    if (!formData.street || !formData.city) {
      toast.error("Please set a delivery location first.");
      return;
    }
    const addr = {
      id: activeAddress?.id || Date.now().toString(),
      ...formData,
      fullAddress: fullAddress || `${formData.street}, ${formData.city}, ${formData.state} ${formData.zip}`,
      lat: position?.lat,
      lng: position?.lng,
    };
    localStorage.setItem(`${STORAGE_KEY}_active`, JSON.stringify(addr));
    setActiveAddress(addr);
    toast.success("Delivery location confirmed! 📍");
  };

  const handleDeleteAddress = (id) => {
    const updated = savedAddresses.filter((a) => a.id !== id);
    setSavedAddresses(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    if (activeAddress?.id === id) {
      localStorage.removeItem(`${STORAGE_KEY}_active`);
      setActiveAddress(null);
    }
    toast.success("Address removed.");
  };

  const handleSelectSaved = (address) => {
    applyAddressData(address);
    setFormData((prev) => ({
      ...prev,
      street: address.street || "",
      apt: address.apt || "",
      city: address.city || "",
      state: address.state || "",
      zip: address.zip || "",
      label: address.label || "Home",
      instructions: address.instructions || "",
    }));
    setActiveAddress(address);
    localStorage.setItem(`${STORAGE_KEY}_active`, JSON.stringify(address));
    toast.success(`"${address.label}" selected as delivery address.`);
  };

  if (geoLoading) return <LocationSkeleton />;

  return (
    <div className="pt-20 min-h-screen pb-16">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[0.125rem]">
            <span className="text-neon-pink">Delivery</span> Location
          </h1>
          <p className="text-center text-text-gray text-lg">
            Set where you'd like your order delivered
          </p>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-8">
        {/* ── Active address banner ───────────────────────────────────────── */}
        {activeAddress && (
          <div className="mb-6 flex items-center gap-3 p-4 bg-neon-pink/5 border border-neon-pink/20 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-neon-pink/15 flex items-center justify-center flex-shrink-0 text-sm">
              {getLabelEmoji(activeAddress.label)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.6875rem] uppercase tracking-wide text-neon-pink font-semibold mb-0.5">
                Active Delivery Address
              </p>
              <p className="text-white text-sm truncate">
                {activeAddress.fullAddress || `${activeAddress.street}, ${activeAddress.city}`}
              </p>
            </div>
            <CheckIcon className="w-5 h-5 text-neon-pink flex-shrink-0" />
          </div>
        )}

        <div className="grid grid-cols-[1fr_20rem] lg:grid-cols-1 gap-6">

          {/* ── Left: Map + search ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Map */}
            <div className="relative w-full h-80 md:h-56 rounded-2xl overflow-hidden border border-white/5 bg-bg-card">
              <LocationMap
                position={position || DEFAULT_CENTER}
                onMapClick={applyAddressData}
                onDragEnd={applyAddressData}
                loading={mapLoading}
              />
            </div>

            {/* Address search */}
            <AddressSearchInput onPlaceSelect={applyAddressData} />

            {/* Selected address preview */}
            {fullAddress && (
              <div className="flex items-start gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl">
                <MapPinIcon className="w-4 h-4 text-neon-pink flex-shrink-0 mt-0.5" />
                <p className="text-white text-sm flex-1">{fullAddress}</p>
                <button
                  onClick={() => { setFullAddress(""); setFormData((p) => ({ ...p, street: "", city: "", state: "", zip: "" })); }}
                  className="text-text-gray hover:text-white transition-colors bg-transparent border-0 cursor-pointer p-0 flex-shrink-0"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* ── Right: Address form ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Address label selector */}
            <div className="bg-bg-card border border-white/5 rounded-2xl p-5">
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-3">
                Address Label
              </p>
              <div className="grid grid-cols-4 gap-2">
                {LABELS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setFormData((p) => ({ ...p, label: l.id }))}
                    className={`flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer border active:scale-[0.97] ${
                      formData.label === l.id
                        ? "bg-neon-pink/10 border-neon-pink/40 text-neon-pink"
                        : "bg-white/[0.03] border-white/10 text-text-gray hover:bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <span className="text-base">{l.emoji}</span>
                    {l.id}
                  </button>
                ))}
              </div>
            </div>

            {/* Address form fields */}
            <div className="bg-bg-card border border-white/5 rounded-2xl p-5 space-y-4">
              <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">
                Address Details
              </p>

              {/* Street */}
              <div>
                <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                  Street Address <span className="text-neon-pink">*</span>
                </label>
                <input
                  type="text"
                  value={formData.street}
                  onChange={(e) => setFormData((p) => ({ ...p, street: e.target.value }))}
                  placeholder="123 Main St"
                  className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink"
                />
              </div>

              {/* Apt */}
              <div>
                <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                  Apt / Suite / Floor
                </label>
                <input
                  type="text"
                  value={formData.apt}
                  onChange={(e) => setFormData((p) => ({ ...p, apt: e.target.value }))}
                  placeholder="Apt 2B (optional)"
                  className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink"
                />
              </div>

              {/* City / State / Zip */}
              <div className="grid grid-cols-[1fr_4rem_6rem] gap-2">
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                    City <span className="text-neon-pink">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData((p) => ({ ...p, city: e.target.value }))}
                    placeholder="Springfield"
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-3 py-3 text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink"
                  />
                </div>
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">State</label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => setFormData((p) => ({ ...p, state: e.target.value }))}
                    placeholder="IL"
                    maxLength={2}
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-3 py-3 text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">Zip</label>
                  <input
                    type="text"
                    value={formData.zip}
                    onChange={(e) => setFormData((p) => ({ ...p, zip: e.target.value }))}
                    placeholder="62701"
                    maxLength={5}
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-3 py-3 text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink"
                  />
                </div>
              </div>

              {/* Delivery instructions */}
              <div>
                <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                  Delivery Instructions
                </label>
                <textarea
                  value={formData.instructions}
                  onChange={(e) => setFormData((p) => ({ ...p, instructions: e.target.value }))}
                  placeholder="Meet me at the north entrance, I'm wearing a red shirt…"
                  rows={3}
                  className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none transition-all duration-200 placeholder:text-text-gray hover:border-white/20 focus:border-neon-pink resize-none"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleConfirm}
                className="w-full py-3.5 bg-neon-pink text-white rounded-xl font-semibold text-sm uppercase tracking-wide hover:bg-[#e0006b] transition-colors duration-200 shadow-[0_4px_12px_rgba(255,0,119,0.3)] active:scale-[0.97] cursor-pointer border-0"
              >
                Confirm Delivery Location
              </button>
              <button
                onClick={handleSave}
                className="w-full py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 transition-colors duration-200 active:scale-[0.97] cursor-pointer"
              >
                Save Address
              </button>
            </div>
          </div>
        </div>

        {/* ── Saved addresses ─────────────────────────────────────────────────── */}
        {savedAddresses.length > 0 && (
          <div className="mt-10">
            <h2 className="font-bebas text-[1.75rem] tracking-wide mb-4">
              Saved Addresses
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {savedAddresses.map((address) => (
                <SavedAddressCard
                  key={address.id}
                  address={address}
                  onSelect={handleSelectSaved}
                  onDelete={handleDeleteAddress}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Wrapper with APIProvider ──────────────────────────────────────────────────

const Location = () => {
  if (!MAPS_API_KEY) {
    return (
      <div className="pt-20 min-h-screen flex flex-col items-center justify-center pb-16 px-5">
        <div className="bg-bg-card border border-amber-500/20 rounded-2xl p-8 max-w-md text-center">
          <ExclamationCircleIcon className="w-10 h-10 text-amber-400 mx-auto mb-4" />
          <h3 className="font-bebas text-[1.75rem] tracking-wide text-white mb-2">Maps Not Configured</h3>
          <p className="text-text-gray text-sm">
            Add <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono text-white">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to your environment variables to enable the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      <LocationInner />
    </APIProvider>
  );
};

export default Location;
