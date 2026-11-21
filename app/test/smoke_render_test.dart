import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:credo/main.dart';
import 'package:credo/state/app_controller.dart';
import 'package:credo/data/services/credo_api_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'dart:convert';

void main() {
  testWidgets('CredoApp renders full shell and feed without errors', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final mockClient = MockClient((req) async {
      if (req.url.path.endsWith('/stats')) {
        return http.Response(jsonEncode({'units': 54, 'countries': 11, 'clergy': 9, 'members': 10, 'posts': 9}), 200);
      }
      if (req.url.path.endsWith('/units/tree')) {
        return http.Response(jsonEncode({'units': [
          {'id': 1, 'slug': 'santa-sede', 'name': 'Santa Sede', 'unit_type': 'holy_see', 'country_code': 'VA', 'country_name': 'Vaticano', 'accent_color': '#B8860B'}
        ]}), 200);
      }
      if (req.url.path.endsWith('/posts')) {
        return http.Response(jsonEncode({'posts': []}), 200);
      }
      return http.Response('{}', 200);
    });
    final controller = AppController(api: CredoApiService(client: mockClient, baseUrl: 'https://credoapp.tech'));
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(CredoApp(controller: controller));
    await tester.pumpAndSettle();

    expect(find.text('Credo'), findsWidgets);
  });
}
