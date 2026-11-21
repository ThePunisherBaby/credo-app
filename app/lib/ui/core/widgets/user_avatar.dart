import 'package:flutter/material.dart';
import '../../../domain/models/credo_user.dart';
import '../labels.dart';
import '../theme.dart';

class UserAvatar extends StatelessWidget {
  const UserAvatar({
    super.key,
    required this.user,
    this.radius = 22,
    this.showBadge = true,
  });

  final CredoUser user;
  final double radius;
  final bool showBadge;

  @override
  Widget build(BuildContext context) {
    final bgColor = parseHexColor(
      user.avatarColor,
      fallback: rankColor(user.ecclesiasticalRank),
    );
    final ringColor = user.canPublish
        ? CredoColors.vaticanGold
        : CredoColors.hairline;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          padding: EdgeInsets.all(user.canPublish ? 2 : 1),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: ringColor,
              width: user.canPublish ? 2 : 1,
            ),
          ),
          child: CircleAvatar(
            radius: radius,
            backgroundColor: bgColor,
            child: Text(
              user.initials,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: radius * 0.68,
                letterSpacing: 0.5,
              ),
            ),
          ),
        ),
        if (showBadge && user.isVerified)
          Positioned(
            right: -2,
            bottom: -2,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.verified_rounded,
                size: radius * 0.62,
                color: CredoColors.vaticanGold,
              ),
            ),
          ),
      ],
    );
  }
}
