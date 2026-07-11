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
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

export type FinancialGroupOption = {
  financialGroupCode: string;
  financialGroupDescription: string;
  codN2: string;
  nivel2: string;
};

type FinancialGroupComboboxProps = {
  options: FinancialGroupOption[];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  selectedDescription?: string | null;
  disabled?: boolean;
};

export function FinancialGroupCombobox({
  options,
  value,
  onChange,
  selectedDescription,
  disabled = false,
}: FinancialGroupComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = useMemo(
    () => options.find(option => option.financialGroupCode === value),
    [options, value]
  );
  const label =
    selectedOption?.financialGroupDescription ||
    selectedDescription ||
    "Seleccione un grupo financiero";

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
            {label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Buscar grupo financiero..." />
          <CommandList>
            <CommandEmpty>No se encontraron grupos financieros.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="sin grupo financiero"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value ? "opacity-0" : "opacity-100"
                  )}
                />
                Sin grupo financiero
              </CommandItem>
              {options.map(option => (
                <CommandItem
                  key={option.financialGroupCode}
                  value={`${option.financialGroupDescription} ${option.financialGroupCode} ${option.codN2} ${option.nivel2}`}
                  onSelect={() => {
                    onChange(option.financialGroupCode);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.financialGroupCode
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  <span className="truncate">
                    {option.financialGroupDescription}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
