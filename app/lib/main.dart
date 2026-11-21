import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'l10n/generated/app_localizations.dart';
import 'state/app_controller.dart';
import 'ui/core/theme.dart';
import 'ui/features/shell/credo_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const CredoApp());
}

class CredoApp extends StatefulWidget {
  const CredoApp({super.key, this.controller});

  final AppController? controller;

  @override
  State<CredoApp> createState() => _CredoAppState();
}

class _CredoAppState extends State<CredoApp> {
  late final AppController _controller;
  late final bool _ownsController;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    _controller = widget.controller ?? AppController();
    _controller.initialize();
  }

  @override
  void dispose() {
    if (_ownsController) {
      _controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _controller,
      builder: (context, _) {
        return MaterialApp(
          title: 'Credo',
          debugShowCheckedModeBanner: false,
          theme: buildCredoTheme(),
          locale: _controller.locale,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: const [
            Locale('es'),
            Locale('en'),
            Locale('it'),
            Locale('pt'),
            Locale('fr'),
          ],
          home: _controller.initialized
              ? CredoShell(controller: _controller)
              : const _CredoSplash(),
        );
      },
    );
  }
}

class _CredoSplash extends StatelessWidget {
  const _CredoSplash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: CredoColors.parchment,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 34,
              backgroundColor: CredoColors.cardinal,
              child: Icon(
                Icons.add_rounded,
                size: 38,
                color: CredoColors.vaticanGoldSoft,
              ),
            ),
            SizedBox(height: 16),
            Text(
              'CREDO',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                letterSpacing: 3.0,
                color: CredoColors.cardinal,
              ),
            ),
            SizedBox(height: 18),
            SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: CredoColors.vaticanGold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
