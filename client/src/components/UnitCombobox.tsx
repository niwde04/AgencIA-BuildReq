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
import { UNITS } from "@shared/units";
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

type UnitComboboxProps = {
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function UnitCombobox({
  value,
  onChange,
  disabled = false,
}: UnitComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = useMemo(
    () => UNITS.find(option => option.value === value),
    [value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn(
              "truncate text-left",
              !value && "text-muted-foreground"
            )}
          >
            {selectedOption?.label || value || "Seleccione una unidad"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Buscar unidad..." />
          <CommandList>
            <CommandEmpty>No se encontraron unidades.</CommandEmpty>
            <CommandGroup>
              {UNITS.map(option => (
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
