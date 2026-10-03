'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';

/** A dropdown of checkboxes (seniorities in «Buscar prospectos»), moved out of the search page without changes. */
export function MultiCheckDropdown({
  label,
  options,
  value,
  onChange,
  placeholder = 'Seleccionar',
  disabled = false,
}: {
  label?: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const triggerId = React.useId();
  const toggle = (val: string, checked: boolean) => {
    const set = new Set(value);
    if (checked) set.add(val); else set.delete(val);
    onChange(Array.from(set));
  };
  const selectedCount = value.length;
  const buttonText =
    selectedCount === 0 ? placeholder :
      selectedCount === 1 ? options.find(o => o.value === value[0])?.label ?? '1 seleccionado'
        : `${selectedCount} seleccionados`;

  return (
    <div className="grid gap-2">
      {label ? <Label htmlFor={triggerId}>{label}</Label> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={triggerId} variant="outline" role="combobox" className="justify-between w-full" disabled={disabled}>
            <span className="truncate">{buttonText}</span>
            <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-80 overflow-auto">
          {options.map(opt => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={value.includes(opt.value)}
              disabled={disabled}
              onCheckedChange={(c) => toggle(opt.value, Boolean(c))}
              className="capitalize"
            >
              {opt.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
