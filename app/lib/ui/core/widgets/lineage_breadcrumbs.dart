import 'package:flutter/material.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../labels.dart';
import '../theme.dart';

class LineageBreadcrumbs extends StatelessWidget {
  const LineageBreadcrumbs({
    super.key,
    required this.lineage,
    this.onTapUnit,
    this.compact = false,
  });

  final List<EcclesiasticalUnit> lineage;
  final void Function(int unitId)? onTapUnit;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (lineage.isEmpty) return const SizedBox.shrink();

    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 4,
      runSpacing: 4,
      children: [
        for (int i = 0; i < lineage.length; i++) ...[
          if (i > 0)
            Icon(
              Icons.chevron_right_rounded,
              size: compact ? 14 : 16,
              color: CredoColors.mutedInk.withValues(alpha: 0.7),
            ),
          _BreadcrumbChip(
            unit: lineage[i],
            isLeaf: i == lineage.length - 1,
            compact: compact,
            onTap: onTapUnit != null ? () => onTapUnit!(lineage[i].id) : null,
          ),
        ],
      ],
    );
  }
}

class _BreadcrumbChip extends StatelessWidget {
  const _BreadcrumbChip({
    required this.unit,
    required this.isLeaf,
    required this.compact,
    this.onTap,
  });

  final EcclesiasticalUnit unit;
  final bool isLeaf;
  final bool compact;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final accent = parseHexColor(unit.accentColor, fallback: CredoColors.cardinal);
    final child = Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 7 : 9,
        vertical: compact ? 2.5 : 4,
      ),
      decoration: BoxDecoration(
        color: isLeaf ? accent.withValues(alpha: 0.12) : CredoColors.warmTint,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isLeaf ? accent.withValues(alpha: 0.35) : CredoColors.hairline,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            unitTypeIcon(unit.unitType),
            size: compact ? 12 : 14,
            color: isLeaf ? accent : CredoColors.mutedInk,
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              unit.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: compact ? 11.5 : 12.5,
                fontWeight: isLeaf ? FontWeight.w700 : FontWeight.w500,
                color: isLeaf ? accent : CredoColors.ink,
              ),
            ),
          ),
        ],
      ),
    );

    if (onTap == null) return child;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: child,
    );
  }
}
