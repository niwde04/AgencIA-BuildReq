export type ProjectLabelReference = {
  id: number;
  code?: string | null;
  name?: string | null;
};

export type ArticleProjectReference = {
  tipoArticulo?: number | null;
  projectId?: number | null;
  projectCode?: string | null;
  projectName?: string | null;
};

export function formatProjectLabel(project: ProjectLabelReference) {
  const code = project.code?.trim();
  const name = project.name?.trim();
  return [code, name].filter(Boolean).join(" - ") || "Proyecto sin nombre";
}

export function getArticleProjectLabel(
  article: ArticleProjectReference,
  projectById: ReadonlyMap<number, ProjectLabelReference>
) {
  if (article.tipoArticulo !== 3) return "-";
  if (!article.projectId) return "Sin proyecto";

  if (article.projectCode?.trim() || article.projectName?.trim()) {
    return formatProjectLabel({
      id: article.projectId,
      code: article.projectCode,
      name: article.projectName,
    });
  }

  const project = projectById.get(article.projectId);
  return project ? formatProjectLabel(project) : "Proyecto sin nombre";
}
