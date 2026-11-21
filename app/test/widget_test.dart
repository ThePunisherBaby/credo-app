import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:credo/ui/core/labels.dart';

void main() {
  test('Clergy rank permissions match business rule', () {
    expect(isClergyRankCode('pope'), isTrue);
    expect(isClergyRankCode('cardinal'), isTrue);
    expect(isClergyRankCode('archbishop'), isTrue);
    expect(isClergyRankCode('bishop'), isTrue);
    expect(isClergyRankCode('monsignor'), isTrue);
    expect(isClergyRankCode('priest'), isTrue);
    expect(isClergyRankCode('deacon'), isTrue);

    expect(isClergyRankCode('lay'), isFalse);
    expect(isClergyRankCode('religious'), isFalse);
    expect(isClergyRankCode('seminarian'), isFalse);
    expect(isClergyRankCode('catechist'), isFalse);
  });

  test('Country flags resolve cleanly', () {
    expect(countryFlag('DO'), '🇩🇴');
    expect(countryFlag('VA'), '🇻🇦');
    expect(countryFlag('ES'), '🇪🇸');
    expect(countryFlag(''), '🌍');
  });

  test('Rank colors return valid Flutter Color instances', () {
    expect(rankColor('cardinal'), isA<Color>());
    expect(rankColor('bishop'), isA<Color>());
    expect(rankColor('lay'), isA<Color>());
  });
}
