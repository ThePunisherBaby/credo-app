import 'package:flutter/material.dart';
import '../../../domain/models/credo_post.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/lineage_breadcrumbs.dart';
import '../../core/widgets/rank_badge.dart';
import '../../core/widgets/user_avatar.dart';

class PostCard extends StatelessWidget {
  const PostCard({
    super.key,
    required this.post,
    required this.controller,
    required this.onTapAuthor,
    required this.onTapUnit,
    required this.onReact,
    required this.onOpenComments,
    this.onDelete,
  });

  final CredoPost post;
  final AppController controller;
  final void Function(int userId) onTapAuthor;
  final void Function(int unitId) onTapUnit;
  final void Function(String reactionType) onReact;
  final VoidCallback onOpenComments;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final typeColor = postTypeColor(post.postType);
    final canDelete = controller.currentUser != null &&
        (controller.currentUser!.id == post.author.id ||
            controller.currentUser!.isAdmin);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top badge row: publication type + pinned + scope unit
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: typeColor.withValues(alpha: 0.11),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(postTypeIcon(post.postType),
                          size: 14, color: typeColor),
                      const SizedBox(width: 5),
                      Text(
                        postTypeLabel(l10n, post.postType),
                        style: TextStyle(
                          color: typeColor,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                if (post.isPinned)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: CredoColors.vaticanGoldSoft,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.push_pin_rounded,
                            size: 13, color: CredoColors.vaticanGold),
                        const SizedBox(width: 4),
                        Text(
                          l10n.pinned,
                          style: const TextStyle(
                            color: CredoColors.vaticanGold,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                if (post.scopeUnit != null)
                  InkWell(
                    onTap: () => onTapUnit(post.scopeUnit!.id),
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: CredoColors.warmTint,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(countryFlag(post.scopeUnit!.countryCode),
                              style: const TextStyle(fontSize: 12)),
                          const SizedBox(width: 5),
                          Text(
                            post.scopeUnit!.name,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: CredoColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),

            // Author Header
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  onTap: () => onTapAuthor(post.author.id),
                  child: UserAvatar(user: post.author, radius: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          InkWell(
                            onTap: () => onTapAuthor(post.author.id),
                            child: Text(
                              post.author.displayName,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ),
                          RankBadge(
                            rank: post.author.ecclesiasticalRank,
                            isVerified: post.author.isVerified,
                            compact: true,
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        [
                          if (post.author.currentOfficeTitle.isNotEmpty)
                            post.author.currentOfficeTitle,
                          formatRelativeTime(post.createdAt),
                        ].join(' · '),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (post.author.lineage.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        LineageBreadcrumbs(
                          lineage: post.author.lineage.length > 3
                              ? post.author.lineage
                                  .sublist(post.author.lineage.length - 3)
                              : post.author.lineage,
                          onTapUnit: onTapUnit,
                          compact: true,
                        ),
                      ],
                    ],
                  ),
                ),
                if (canDelete && onDelete != null)
                  IconButton(
                    tooltip: l10n.deletePost,
                    icon: const Icon(Icons.delete_outline_rounded, size: 19),
                    color: CredoColors.mutedInk,
                    onPressed: onDelete,
                  ),
              ],
            ),

            // Title + Content
            if (post.title.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(
                post.title,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      height: 1.3,
                    ),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              post.content,
              style: Theme.of(context).textTheme.bodyLarge,
            ),

            // Optional Scripture Reference / Event Location
            if (post.scriptureRef.isNotEmpty || post.eventLocation.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 10,
                runSpacing: 6,
                children: [
                  if (post.scriptureRef.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: CredoColors.vaticanGoldSoft,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: CredoColors.vaticanGold.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.menu_book_rounded,
                              size: 14, color: CredoColors.vaticanGold),
                          const SizedBox(width: 6),
                          Text(
                            post.scriptureRef,
                            style: const TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              fontStyle: FontStyle.italic,
                              color: CredoColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (post.eventLocation.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: CredoColors.warmTint,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.place_rounded,
                              size: 14, color: CredoColors.cardinal),
                          const SizedBox(width: 5),
                          Text(
                            post.eventLocation,
                            style: const TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ],

            const SizedBox(height: 14),
            const Divider(),
            const SizedBox(height: 8),

            // Liturgical Reactions + Comments
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _ReactionButton(
                  icon: Icons.favorite_border_rounded,
                  activeIcon: Icons.favorite_rounded,
                  label: l10n.amen,
                  count: post.reactions['amen'] ?? 0,
                  active: post.myReactions.contains('amen'),
                  onTap: () => onReact('amen'),
                ),
                _ReactionButton(
                  icon: Icons.volunteer_activism_outlined,
                  activeIcon: Icons.volunteer_activism_rounded,
                  label: l10n.pray,
                  count: post.reactions['pray'] ?? 0,
                  active: post.myReactions.contains('pray'),
                  onTap: () => onReact('pray'),
                ),
                _ReactionButton(
                  icon: Icons.auto_awesome_outlined,
                  activeIcon: Icons.auto_awesome_rounded,
                  label: l10n.gratitude,
                  count: post.reactions['gratitude'] ?? 0,
                  active: post.myReactions.contains('gratitude'),
                  onTap: () => onReact('gratitude'),
                ),
                InkWell(
                  onTap: onOpenComments,
                  borderRadius: BorderRadius.circular(999),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: CredoColors.parchment,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: CredoColors.hairline),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.chat_bubble_outline_rounded,
                            size: 15, color: CredoColors.mutedInk),
                        const SizedBox(width: 6),
                        Text(
                          '${l10n.comments} (${post.commentsCount})',
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: CredoColors.ink,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ReactionButton extends StatelessWidget {
  const _ReactionButton({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.count,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final int count;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active
              ? CredoColors.cardinal.withValues(alpha: 0.12)
              : CredoColors.parchment,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: active
                ? CredoColors.cardinal.withValues(alpha: 0.45)
                : CredoColors.hairline,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              active ? activeIcon : icon,
              size: 15,
              color: active ? CredoColors.cardinal : CredoColors.mutedInk,
            ),
            const SizedBox(width: 5),
            Text(
              count > 0 ? '$label · $count' : label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                color: active ? CredoColors.cardinal : CredoColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> showCommentsSheet({
  required BuildContext context,
  required AppController controller,
  required CredoPost post,
  required void Function(int userId) onTapAuthor,
  required VoidCallback onCommentAdded,
  required VoidCallback onRequireAuth,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: CredoColors.warmSurface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (ctx) => _CommentsSheet(
      controller: controller,
      post: post,
      onTapAuthor: onTapAuthor,
      onCommentAdded: onCommentAdded,
      onRequireAuth: onRequireAuth,
    ),
  );
}

class _CommentsSheet extends StatefulWidget {
  const _CommentsSheet({
    required this.controller,
    required this.post,
    required this.onTapAuthor,
    required this.onCommentAdded,
    required this.onRequireAuth,
  });

  final AppController controller;
  final CredoPost post;
  final void Function(int userId) onTapAuthor;
  final VoidCallback onCommentAdded;
  final VoidCallback onRequireAuth;

  @override
  State<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends State<_CommentsSheet> {
  final _inputCtrl = TextEditingController();
  List<CredoComment> _comments = const [];
  bool _loading = true;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await widget.controller.api.fetchComments(widget.post.id);
      if (mounted) {
        setState(() {
          _comments = list;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    if (!widget.controller.isAuthenticated) {
      Navigator.of(context).pop();
      widget.onRequireAuth();
      return;
    }
    final text = _inputCtrl.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      final c = await widget.controller.api.addComment(widget.post.id, text);
      _inputCtrl.clear();
      setState(() => _comments = [..._comments, c]);
      widget.onCommentAdded();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.68,
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: CredoColors.hairline,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 12, 10),
              child: Row(
                children: [
                  Text(
                    '${l10n.comments} (${_comments.length})',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _comments.isEmpty
                      ? Center(
                          child: Text(
                            l10n.noResults,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _comments.length,
                          separatorBuilder: (_, _) =>
                              const SizedBox(height: 12),
                          itemBuilder: (ctx, i) {
                            final c = _comments[i];
                            return Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                GestureDetector(
                                  onTap: () {
                                    Navigator.of(context).pop();
                                    widget.onTapAuthor(c.author.id);
                                  },
                                  child: UserAvatar(user: c.author, radius: 18),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Container(
                                    padding: const EdgeInsets.all(12),
                                    decoration: BoxDecoration(
                                      color: CredoColors.parchment,
                                      borderRadius: BorderRadius.circular(14),
                                      border: Border.all(
                                          color: CredoColors.hairline),
                                    ),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Wrap(
                                          spacing: 6,
                                          crossAxisAlignment:
                                              WrapCrossAlignment.center,
                                          children: [
                                            Text(
                                              c.author.displayName,
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w700,
                                                fontSize: 13.5,
                                              ),
                                            ),
                                            RankBadge(
                                              rank: c.author.ecclesiasticalRank,
                                              isVerified: c.author.isVerified,
                                              compact: true,
                                            ),
                                            Text(
                                              formatRelativeTime(c.createdAt),
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .bodySmall,
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 5),
                                        Text(c.content),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _inputCtrl,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        hintText: widget.controller.isAuthenticated
                            ? l10n.writeComment
                            : l10n.signInRequired,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  FilledButton(
                    onPressed: _sending ? null : _send,
                    child: Text(l10n.send),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
