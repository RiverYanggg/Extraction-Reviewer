export function rowNeedsScroll(rowRect, viewportRect) {
  return rowRect.top < viewportRect.top || rowRect.bottom > viewportRect.bottom;
}

export function isFieldRowNavigable(row) {
  return !row.closest(".tchildren.collapsed");
}

export function keepFieldRowVisible(fieldsList, fieldsScroll, fieldId) {
  const row = [...fieldsList.querySelectorAll(".field-row[data-field-id]")]
    .find((candidate) => candidate.dataset.fieldId === fieldId);
  if (!row || !rowNeedsScroll(row.getBoundingClientRect(), fieldsScroll.getBoundingClientRect())) {
    return false;
  }
  row.scrollIntoView({ block: "nearest" });
  return true;
}
