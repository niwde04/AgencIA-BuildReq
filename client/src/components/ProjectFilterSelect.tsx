import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useMemo } from "react";

type ProjectFilterSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  triggerClassName?: string;
};

export function ProjectFilterSelect({
  value,
  onValueChange,
  triggerClassName = "h-10 w-full lg:w-64",
}: ProjectFilterSelectProps) {
  const { data: projects } = trpc.projects.list.useQuery();
  const projectOptions = useMemo(
    () =>
      [...(projects ?? [])].sort(
        (left: any, right: any) =>
          String(left.code ?? "").localeCompare(
            String(right.code ?? ""),
            "es-HN",
            { numeric: true, sensitivity: "base" }
          ) ||
          String(left.name ?? "").localeCompare(
            String(right.name ?? ""),
            "es-HN",
            { sensitivity: "base" }
          )
      ),
    [projects]
  );

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder="Todos los proyectos" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los proyectos</SelectItem>
        {projectOptions.map((project: any) => (
          <SelectItem key={project.id} value={String(project.id)}>
            {project.code} - {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
