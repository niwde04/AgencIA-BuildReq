import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type UserProfileFieldsProps = {
  idPrefix: string;
  phone: string;
  identityNumber: string;
  jobTitle: string;
  onPhoneChange: (value: string) => void;
  onIdentityNumberChange: (value: string) => void;
  onJobTitleChange: (value: string) => void;
};

export function UserProfileFields({
  idPrefix,
  phone,
  identityNumber,
  jobTitle,
  onPhoneChange,
  onIdentityNumberChange,
  onJobTitleChange,
}: UserProfileFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-phone`}>Número de teléfono</Label>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          autoComplete="tel"
          placeholder="Ej: +504 9999-9999"
          maxLength={50}
          value={phone}
          onChange={event => onPhoneChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-identityNumber`}>
          Número de identidad
        </Label>
        <Input
          id={`${idPrefix}-identityNumber`}
          type="text"
          placeholder="Ej: 0801-1990-12345"
          maxLength={50}
          value={identityNumber}
          onChange={event => onIdentityNumberChange(event.target.value)}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-jobTitle`}>Cargo</Label>
        <Input
          id={`${idPrefix}-jobTitle`}
          autoComplete="organization-title"
          placeholder="Ej: Encargado de bodega"
          maxLength={150}
          value={jobTitle}
          onChange={event => onJobTitleChange(event.target.value)}
        />
      </div>
    </div>
  );
}
