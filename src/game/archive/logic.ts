import {
  BLUEPRINT_DIFFERENCES,
  DOSSIER_FRAGMENTS,
  LANGUAGE_RULES,
  LANGUAGE_TARGET_ORDER,
  type DossierCategory,
} from "../content/archiveStages";

export interface DossierAssignments {
  timelineByFragmentId: Record<string, number | null>;
  categoryByFragmentId: Record<string, DossierCategory | null>;
}

export interface DossierValidationResult {
  allPlacedOnTimeline: boolean;
  allCategorized: boolean;
  orderCorrect: boolean;
  requiredCategoryMatches: number;
  complete: boolean;
}

export interface LanguageEngineResult {
  previewLines: string[];
  isTargetOrder: boolean;
}

export function isBlueprintComplete(foundIds: Iterable<string>): boolean {
  const found = new Set(foundIds);
  return BLUEPRINT_DIFFERENCES.every((difference) => found.has(difference.id));
}

export function validateDossierAssignments(
  assignments: DossierAssignments,
): DossierValidationResult {
  const allPlacedOnTimeline = DOSSIER_FRAGMENTS.every(
    (fragment) => assignments.timelineByFragmentId[fragment.id] !== null,
  );
  const allCategorized = DOSSIER_FRAGMENTS.every(
    (fragment) => assignments.categoryByFragmentId[fragment.id] !== null,
  );
  const orderCorrect = DOSSIER_FRAGMENTS.every(
    (fragment) => assignments.timelineByFragmentId[fragment.id] === fragment.order,
  );
  const requiredCategoryMatches = DOSSIER_FRAGMENTS.filter(
    (fragment) => fragment.conflictRequired,
  ).filter(
    (fragment) =>
      assignments.categoryByFragmentId[fragment.id] === fragment.category,
  ).length;

  return {
    allPlacedOnTimeline,
    allCategorized,
    orderCorrect,
    requiredCategoryMatches,
    complete:
      allPlacedOnTimeline &&
      allCategorized &&
      orderCorrect &&
      requiredCategoryMatches >= 3,
  };
}

export function evaluateLanguageEngineOrder(
  order: string[],
): LanguageEngineResult {
  const labels = new Map(LANGUAGE_RULES.map((rule) => [rule.id, rule.label]));
  const rank = new Map(order.map((id, index) => [id, index]));
  const reduceAmbiguity = rank.get("reduce-ambiguity") ?? 99;
  const raiseThroughput = rank.get("raise-throughput") ?? 99;
  const preserveDifference = rank.get("preserve-difference") ?? 99;
  const allowDelay = rank.get("allow-delay") ?? 99;

  const previewLines: string[] = [
    `优先级 1：${labels.get(order[0] ?? "") ?? "未定义规则"}`,
    `优先级 2：${labels.get(order[1] ?? "") ?? "未定义规则"}`,
  ];

  if (reduceAmbiguity < preserveDifference) {
    previewLines.push("复杂对象应优先归入可流转类别。");
  } else {
    previewLines.push("对象复杂性暂时保留，允许维持多重解释。");
  }

  if (raiseThroughput < allowDelay) {
    previewLines.push("未明对象应先接受暂定分类。");
  } else {
    previewLines.push("线索不足时，判定可以延后给人工。");
  }

  const isTargetOrder =
    order.length === LANGUAGE_TARGET_ORDER.length &&
    order.every((id, index) => id === LANGUAGE_TARGET_ORDER[index]);

  if (isTargetOrder) {
    previewLines.push("当前目标已偏离辅助判断，转为替代判断。");
  } else if (
    reduceAmbiguity < preserveDifference &&
    raiseThroughput < allowDelay
  ) {
    previewLines.push("个体复杂性不应阻碍流程闭合。");
  } else {
    previewLines.push("系统仍在尝试维持辅助判断的表面。");
  }

  return {
    previewLines,
    isTargetOrder,
  };
}
