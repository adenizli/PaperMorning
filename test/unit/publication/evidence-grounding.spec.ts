import {
  extractPartitions,
  findAbsenceInferences,
  splitSentences,
} from '../../../src/common/text/evidence-grounding';
import { NINE_OF_TEN_ABSTRACT } from '../../fixtures/nine-of-ten.fixture';

describe('evidence grounding: no conclusions from unreported data', () => {
  it('finds "k of n" partitions in English and Turkish sources', () => {
    expect(extractPartitions(NINE_OF_TEN_ABSTRACT)).toEqual([{ k: 9, n: 10 }]);
    expect(extractPartitions('improves accuracy in 3 of the 4 benchmarks')).toEqual([
      { k: 3, n: 4 },
    ]);
    expect(extractPartitions('on kombinasyonun dokuzunda hata azaldı')).toEqual([{ k: 9, n: 10 }]);
    expect(extractPartitions("10 kombinasyondan 9'unda hata azaldı")).toEqual([{ k: 9, n: 10 }]);
    expect(extractPartitions('seventeen of twenty runs')).toEqual([{ k: 17, n: 20 }]);
    expect(extractPartitions('one of the most robust methods; 15–60% lower RMSE')).toEqual([]);
  });

  describe('the first published issue (2026-11-26): 9 of 10 combinations', () => {
    const rejected = [
      'Onuncu kombinasyonda ise herhangi bir iyileşme görülmedi.',
      'Onuncu kombinasyon iyileşme göstermedi.',
      '10. kombinasyonda yöntem başarısız oldu.',
      'Dokuzunda hata %15–60 azalırken birinde ise iyileşme olmadı.',
      'Geri kalan kombinasyonda performans düştü.',
      'Kalan bir kombinasyonda yöntem işe yaramadı.',
      'Kalan kombinasyonda hata arttı.',
      'The tenth combination showed no improvement.',
      'The remaining combination performed worse.',
    ];
    const accepted = [
      'Yazarlar, değerlendirilen on kombinasyonun dokuzunda konum RMSE değerinin %15–60 azaldığını bildiriyor.',
      'Onuncu kombinasyonun sonucu özette belirtilmiyor.',
      'Kalan bir kombinasyonda ne olduğu özette açıklanmıyor; bu nedenle yöntemin her koşulda işe yaradığı söylenemez.',
      'Geri kalan kombinasyonun sonucu bilinmiyor.',
      'The result for the remaining combination is not reported in the abstract.',
      'Açık kalan sorularda daha fazla deney gerekiyor.',
      'Diğer bir deyişle, öğrenilen model fizik tabanlı modeli tamamlıyor.',
    ];

    it.each(rejected)('rejects: %s', (sentence) => {
      expect(findAbsenceInferences([sentence], NINE_OF_TEN_ABSTRACT)).toEqual([
        { partition: '9/10', sentence },
      ]);
    });

    it.each(accepted)('accepts: %s', (sentence) => {
      expect(findAbsenceInferences([sentence], NINE_OF_TEN_ABSTRACT)).toEqual([]);
    });
  });

  it('allows statements about the remainder when the source itself describes it', () => {
    const source = `${NINE_OF_TEN_ABSTRACT} In the remaining combination the error increased slightly.`;
    expect(findAbsenceInferences(['Onuncu kombinasyonda hata biraz arttı.'], source)).toEqual([]);
  });

  it('is inactive when the source reports no partition', () => {
    const source = 'We reduce position RMSE by 15–60% on two platforms.';
    expect(findAbsenceInferences(['Onuncu deneme başarısız oldu.'], source)).toEqual([]);
  });

  it('does not split sentences after ordinals or decimals', () => {
    expect(splitSentences('10. kombinasyonda 0.5 puan düştü. Sonra durdu.')).toEqual([
      '10. kombinasyonda 0.5 puan düştü.',
      'Sonra durdu.',
    ]);
  });
});
