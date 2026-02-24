import { useState, useEffect, useRef } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPinIcon } from "@heroicons/react/24/outline";

const AddressAutocomplete = ({ value, onChange, onPlaceSelect }) => {
  const [inputValue, setInputValue] = useState(value || "");
  const inputRef = useRef(null);
  const places = useMapsLibrary("places");

  useEffect(() => {
    if (!places || !inputRef.current) return;

    const autocompleteInstance = new places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      fields: ["address_components", "geometry", "formatted_address"],
      types: ["address"],
    });

    autocompleteInstance.addListener("place_changed", () => {
      const place = autocompleteInstance.getPlace();
      if (place.formatted_address) {
        setInputValue(place.formatted_address);
        onChange?.(place.formatted_address);
        onPlaceSelect?.(place);
      }
    });

    return () => {
      window.google?.maps?.event?.clearInstanceListeners(autocompleteInstance);
    };
  }, [places]);

  return (
    <div className="flex items-center gap-2 flex-1 px-3 py-2">
      <MapPinIcon className="w-5 h-5 text-neon-pink flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange?.(e.target.value);
        }}
        placeholder="Delivery address"
        className="bg-transparent border-0 text-white outline-none flex-1 text-[1rem] placeholder:text-text-gray w-full"
      />
    </div>
  );
};

export default AddressAutocomplete;
