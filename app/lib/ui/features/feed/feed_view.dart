import 'package:flutter/material.dart';
import '../../../domain/models/credo_post.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/user_avatar.dart';
import '../auth/auth_sheet.dart';
import 'compose_post_dialog.dart';
import 'post_card.dart';

class FeedView extends StatefulWidget {
  const FeedView({
    super.key,
    required this.controller,
    required this.onOpenProfile,
    required this.onOpenUnit,
  });

  final AppController controller;
  final void Function(int userId) onOpenProfile;
  final void Function(int unitId) onOpenUnit;

  @override
  State<FeedView> createState() => _FeedViewState();
}

class _FeedViewState extends State<FeedView> {
  String _scope = 'global';
  String? _postTypeFilter;
  List<CredoPost> _posts = const [];
  EcclesiasticalUnit? _resolvedScope;
  bool _loading = true;
  int _lastDataVersion = -1;

  @override
  void initState() {
    super.initState();
    _lastDataVersion = widget.controller.dataVersion;
    widget.controller.addListener(_onControllerChanged);
    _loadFeed();
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    super.dispose();
  }

  void _onControllerChanged() {
    if (widget.controller.dataVersion != _lastDataVersion) {
      _lastDataVersion = widget.controller.dataVersion;
      if (!widget.controller.isAuthenticated && _scope != 'global') {
        _scope = 'global';
      }
      _loadFeed();
    }
  }

  Future<void> _loadFeed() async {
    setState(() => _loading = true);
    try {
      final res = await widget.controller.api.fetchPosts(
        scope: _scope,
        postType: _postTypeFilter,
      );
      if (mounted) {
        setState(() {
          _posts = res.posts;
          _resolvedScope = res.resolvedScope;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openComposer() async {
    final created = await showComposePostDialog(
      context: context,
      controller: widget.controller,
    );
    if (created != null) {
      setState(() => _posts = [created, ..._posts]);
      widget.controller.refreshGlobalData();
    }
  }

  Future<void> _handleReaction(CredoPost post, String reactionType) async {
    if (!widget.controller.isAuthenticated) {
      await showAuthDialog(context: context, controller: widget.controller);
      return;
    }
    try {
      final res = await widget.controller.api.toggleReaction(
        post.id,
        reactionType,
      );
      final updatedMy = Set<String>.from(post.myReactions);
      if (res.active) {
        updatedMy.add(reactionType);
      } else {
        updatedMy.remove(reactionType);
      }
      setState(() {
        _posts = _posts
            .map((p) => p.id == post.id
                ? p.copyWith(reactions: res.reactions, myReactions: updatedMy)
                : p)
            .toList();
      });
    } catch (_) {}
  }

  Future<void> _handleDelete(CredoPost post) async {
    try {
      await widget.controller.api.deletePost(post.id);
      setState(() => _posts = _posts.where((p) => p.id != post.id).toList());
      widget.controller.refreshGlobalData();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final user = widget.controller.currentUser;

    final scopes = <(String, String, IconData)>[
      ('global', l10n.scopeGlobal, Icons.public_rounded),
      if (user != null) ...[
        ('following', l10n.scopeFollowing, Icons.bookmark_rounded),
        ('my_country', l10n.scopeMyCountry, Icons.flag_rounded),
        ('my_archdiocese', l10n.scopeMyArchdiocese, Icons.location_city_rounded),
        ('my_diocese', l10n.scopeMyDiocese, Icons.church_rounded),
        ('my_parish', l10n.scopeMyParish, Icons.home_work_rounded),
      ],
    ];

    return RefreshIndicator(
      onRefresh: _loadFeed,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
        children: [
          // Top action / role card
          if (user == null)
            _WelcomeCard(
              onSignIn: () => showAuthDialog(
                context: context,
                controller: widget.controller,
              ),
              onRegister: () => showAuthDialog(
                context: context,
                controller: widget.controller,
                initialRegister: true,
              ),
            )
          else if (user.canPublish)
            Card(
              child: InkWell(
                onTap: _openComposer,
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      UserAvatar(user: user, radius: 22),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 11),
                          decoration: BoxDecoration(
                            color: CredoColors.parchment,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: CredoColors.hairline),
                          ),
                          child: Text(
                            l10n.postContent,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: CredoColors.mutedInk),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      FilledButton.icon(
                        onPressed: _openComposer,
                        icon: const Icon(Icons.edit_note_rounded, size: 18),
                        label: Text(l10n.publish),
                      ),
                    ],
                  ),
                ),
              ),
            )
          else
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: CredoColors.vaticanGoldSoft,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: CredoColors.vaticanGold.withValues(alpha: 0.35),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.church_rounded,
                      color: CredoColors.vaticanGold, size: 22),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.clergyOnlyPublishTitle,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: CredoColors.ink,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          l10n.clergyOnlyPublishDesc,
                          style: const TextStyle(
                            fontSize: 13,
                            color: CredoColors.mutedInk,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: 14),

          // Hierarchical Scope Filter Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: scopes.map((s) {
                final selected = _scope == s.$1;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    avatar: Icon(
                      s.$3,
                      size: 16,
                      color: selected ? Colors.white : CredoColors.cardinal,
                    ),
                    label: Text(
                      s.$2,
                      style: TextStyle(
                        color: selected ? Colors.white : CredoColors.ink,
                      ),
                    ),
                    selected: selected,
                    selectedColor: CredoColors.cardinal,
                    onSelected: (_) {
                      setState(() => _scope = s.$1);
                      _loadFeed();
                    },
                  ),
                );
              }).toList(),
            ),
          ),

          // Secondary filter by Post Type
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                FilterChip(
                  label: Text(l10n.filterAllRanks.split(' ').first),
                  selected: _postTypeFilter == null,
                  onSelected: (_) {
                    setState(() => _postTypeFilter = null);
                    _loadFeed();
                  },
                ),
                const SizedBox(width: 6),
                for (final t in kPostTypes) ...[
                  FilterChip(
                    avatar: Icon(postTypeIcon(t),
                        size: 15, color: postTypeColor(t)),
                    label: Text(postTypeLabel(l10n, t)),
                    selected: _postTypeFilter == t,
                    onSelected: (_) {
                      setState(
                        () => _postTypeFilter = _postTypeFilter == t ? null : t,
                      );
                      _loadFeed();
                    },
                  ),
                  const SizedBox(width: 6),
                ],
              ],
            ),
          ),

          if (_resolvedScope != null) ...[
            const SizedBox(height: 10),
            InkWell(
              onTap: () => widget.onOpenUnit(_resolvedScope!.id),
              borderRadius: BorderRadius.circular(10),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: CredoColors.warmTint,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(unitTypeIcon(_resolvedScope!.unitType),
                        size: 16, color: CredoColors.cardinal),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${countryFlag(_resolvedScope!.countryCode)} ${_resolvedScope!.name}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 13),
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, size: 13),
                  ],
                ),
              ),
            ),
          ],

          const SizedBox(height: 14),

          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_posts.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  children: [
                    const Icon(Icons.auto_stories_outlined,
                        size: 42, color: CredoColors.mutedInk),
                    const SizedBox(height: 10),
                    Text(
                      l10n.noPostsYet,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            )
          else
            for (final post in _posts) ...[
              PostCard(
                post: post,
                controller: widget.controller,
                onTapAuthor: widget.onOpenProfile,
                onTapUnit: widget.onOpenUnit,
                onReact: (type) => _handleReaction(post, type),
                onDelete: () => _handleDelete(post),
                onOpenComments: () => showCommentsSheet(
                  context: context,
                  controller: widget.controller,
                  post: post,
                  onTapAuthor: widget.onOpenProfile,
                  onRequireAuth: () => showAuthDialog(
                    context: context,
                    controller: widget.controller,
                  ),
                  onCommentAdded: () {
                    setState(() {
                      _posts = _posts
                          .map((p) => p.id == post.id
                              ? p.copyWith(commentsCount: p.commentsCount + 1)
                              : p)
                          .toList();
                    });
                  },
                ),
              ),
              const SizedBox(height: 14),
            ],
        ],
      ),
    );
  }
}

class _WelcomeCard extends StatelessWidget {
  const _WelcomeCard({
    required this.onSignIn,
    required this.onRegister,
  });

  final VoidCallback onSignIn;
  final VoidCallback onRegister;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [CredoColors.cardinal, CredoColors.cardinalDark],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.account_balance_rounded,
                    color: CredoColors.vaticanGoldSoft, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.appTitle,
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                            color: Colors.white,
                          ),
                    ),
                    Text(
                      l10n.appSubtitle,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.85),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            l10n.layCannotPublishHint,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.92),
              fontSize: 13.5,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: CredoColors.vaticanGold,
                  foregroundColor: Colors.white,
                ),
                onPressed: onSignIn,
                icon: const Icon(Icons.login_rounded, size: 18),
                label: Text(l10n.signIn),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: BorderSide(color: Colors.white.withValues(alpha: 0.5)),
                ),
                onPressed: onRegister,
                icon: const Icon(Icons.person_add_outlined, size: 18),
                label: Text(l10n.register),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
