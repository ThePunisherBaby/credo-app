import 'package:flutter/material.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../labels.dart';
import '../theme.dart';

class RankBadge extends StatelessWidget {
  const RankBadge({
    super.key,
    required this.rank,
    this.isVerified = false,
    this.compact = false,
  });

  final String rank;
  final bool isVerified;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final color = rankColor(rank);
    final label = rankLabel(l10n, rank);
    final isClergy = isClergyRankCode(rank);

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 10,
        vertical: compact ? 2.5 : 4,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: color.withValues(alpha: 0.35),
          width: 0.9,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isClergy) ...[
            Icon(
              Icons.add_rounded,
              size: compact ? 11 : 13,
              color: color,
            ),
            const SizedBox(width: 3),
          ],
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: compact ? 11 : 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.1,
            ),
          ),
          if (isVerified) ...[
            const SizedBox(width: 4),
            Icon(
              Icons.verified_rounded,
              size: compact ? 12 : 14,
              color: CredoColors.vaticanGold,
            ),
          ],
        ],
      ),
    );
  }
}
