'use client'

import { useState, useEffect, useRef } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { MapPinIcon } from '@heroicons/react/24/outline'
import { streetLineFromPlace } from '@/lib/delivery-address'

interface Props {
  value?: string
  onChange?: (value: string) => void
  onPlaceSelect?: (place: google.maps.places.PlaceResult) => void
}

export default function AddressAutocomplete({ value, onChange, onPlaceSelect }: Props) {
  const [inputValue, setInputValue] = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const places = useMapsLibrary('places')

  useEffect(() => {
    if (!places || !inputRef.current) return

    const autocompleteInstance = new places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'us' },
      fields: ['address_components', 'geometry', 'formatted_address'],
      types: ['address'],
    })

    autocompleteInstance.addListener('place_changed', () => {
      const place = autocompleteInstance.getPlace()
      if (place.formatted_address) {
        // The street line only: city, state and ZIP have their own fields.
        const street = streetLineFromPlace(place)
        setInputValue(street)
        onChange?.(street)
        onPlaceSelect?.(place)
      }
    })

    return () => {
      window.google?.maps?.event?.clearInstanceListeners(autocompleteInstance)
    }
  }, [places])

  return (
    <div className="flex items-center gap-2 flex-1 px-3 py-2">
      <MapPinIcon className="w-5 h-5 text-[#FF0077] flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={e => {
          setInputValue(e.target.value)
          onChange?.(e.target.value)
        }}
        autoComplete="address-line1"
        placeholder="Delivery address"
        className="bg-transparent border-0 text-white outline-none flex-1 text-base placeholder:text-[#A1A1A1] w-full"
      />
    </div>
  )
}
