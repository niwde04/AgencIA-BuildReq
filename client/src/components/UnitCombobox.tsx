import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { UNITS, type UnitOption } from "@shared/units";
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

type UnitComboboxProps = {
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  options?: readonly UnitOption[];
  placeholder?: string;
  "aria-describedby"?: string;
};

export function UnitCombobox({
  value,
  onChange,
  disabled = false,
  id,
  className,
  contentClassName,
  options = UNITS,
  placeholder = "Seleccione una unidad",
  "aria-describedby": describedBy,
}: UnitComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
          title={selectedOption?.label || value || undefined}
        >
          <span
            className={cn(
              "truncate text-left",
              !value && "text-muted-foreground"
            )}
          >
            {selectedOption?.label || value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-[var(--radix-popover-trigger-width)] p-0",
          contentClassName
        )}
      >
        <Command>
          <CommandInput
            placeholder="Buscar unidad..."
            aria-label="Buscar unidad"
          />
          <CommandList>
            <CommandEmpty>No se encontraron unidades.</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span>{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
