from ..models.projection import ProjectionCategory, ProjectionRow


def recalculate_category(category: ProjectionCategory) -> ProjectionCategory:
    rows = sorted(category.rows, key=lambda r: r.year)
    for i, row in enumerate(rows):
        if i == 0:
            if row.value == 0:
                row.value = row.deposit
            continue
        prev_value = rows[i - 1].value
        growth = row.growth_pct if row.growth_pct is not None else 0.08
        row.value = round((prev_value * (1 + growth)) + row.deposit, 2)
    category.rows = rows
    return category
