# Análise de compatibilidade: Conditional AE, D&D 5e 5.3 e 6.0

Data: 11/09/2026. Documento interno de engenharia; diagnóstico e plano de adaptação, sem implementação dos adapters.

## Conclusão

**O Conditional AE continua tendo utilidade no 6.0, mas a versão 0.2.0 não deve ser considerada integralmente compatível sem adaptação.** O problema principal não é desaparecer o ponto de interceptação de condições: `ActiveEffect5e.isSuppressed` e `ActiveEffect5e.applyChange` continuam disponíveis. Os maiores problemas estão no patch de aplicação pelo chat, na edição e identidade das alterações, nas origens dos efeitos e na integração dos serviços SC com condições nativas por alteração.

O nativo cobre condições declarativas do efeito inteiro, condições individuais das alterações e regras avaliadas no contexto das rolagens. Ele **não executa os scripts SC** nem reproduz automaticamente a política SC de desabilitação, iluminação, macros e rolagem persistida de fórmulas. A adaptação recomendada é conservar o motor SC e compor sua decisão com a decisão nativa, usando adapters de sistema e capacidades do Foundry.

Suportar dois ambientes não significa que um mundo migrado para 6.0 possa ser reaberto em 5.3. O objetivo é o mesmo pacote do módulo funcionar em mundos separados nas duas versões; conversão reversa de mundos não faz parte deste plano.

## Bases e método

| Base | Referência examinada |
| --- | --- |
| Conditional AE | 0.2.0, commit `679b61fd96ff96d562c6a162c168e6d510767ce7` |
| D&D 5e instalado | Manifest local: 5.3.3; comparação de código com tag oficial `release-5.3.3`, commit `965ad2d0cf5d063dac675ba078b5bd3c3c0dd449` |
| D&D 5e alvo | Tag oficial `release-6.0.0`, commit `2e913fbf578f09a4b2a37e18b314772061a9160f` |
| Foundry exigido pelo 5.3.3 | Mínimo 13.347; manifest também declara verificação no 14 |
| Foundry exigido pelo 6.0.0 auditado | **Mínimo 14.367**, verificado no 14 |
| Branch criada | `analysis/dnd5e-5.3-6.0-compatibility` |

Foram examinados os hooks, serviços, compatibilidade DAE/Aura Effects, fichas, seletores, templates, contextos, manifest e testes do módulo; comparados com os documentos, modelos, filtros, regras, atividades, aplicação pelo chat e regiões do sistema. As fontes remotas foram lidas em checkouts temporários fora do projeto.

As referências fixadas por commit prevalecem sobre exemplos de `master`, `6.0.x` e resultados de busca. Por exemplo, o código auditado usa `shouldApplyChange`; não se deve projetar um adapter a partir de `_checkCondition` encontrado em uma revisão anterior. O mínimo de Foundry também difere de snapshots anteriores que indicavam 14.359.

**Limite de evidência:** análise estática e verificações Node. Não foi executada uma sessão Foundry 14.367 com D&D 6.0, DAE, Aura Effects e Tidy. “Confirmado” abaixo significa diferença demonstrável no código ou em execução isolada; a manifestação final de alguns problemas depende dos shims do core e dos módulos instalados. Não é uma certificação de todos os efeitos existentes em mundos de usuários.

## As condições nativas se aplicam da mesma forma?

Parcialmente. Há três níveis distintos no 6.0:

1. **Efeito inteiro:** `BaseEffectData.conditions`, em `system.conditions`. `ActiveEffectDataModel.evaluateCondition()` avalia e armazena supressão; `isSuppressed` a expõe ao documento. Há avaliação durante aplicação e tratamento específico dos status e dos efeitos sem alterações em `Actor5e.applyActiveEffects`.
2. **Alteração individual:** `system.changes[*].conditions`. `ActiveEffect5e.shouldApplyChange()` respeita a decisão do core, a supressão do efeito e as condições da alteração. Um efeito pode conter alterações que se aplicam e outras que não se aplicam.
3. **Regras de rolagem:** `dnd5e.advantage`, `dnd5e.bonus`, `dnd5e.maximum` e `dnd5e.minimum` são registradas em `appliedRules`. Possuem `skipConditions` para a condição individual na coleta. `RulesIterator.filterWith()` verifica condições do efeito e da alteração com os dados da rolagem. Isso não deve ser transformado em uma alternância persistente de `disabled` a cada ataque.

Há uma sutileza no nível 3: a avaliação global do efeito ainda existe. A ficha nativa avisa sobre `roll.*` em condições globais. Para restringir um bônus a uma rolagem específica, preferir a condição da alteração de regra, sem pressupor que todos os dados da rolagem existam durante preparação do ator.

| Aspecto | SC atual | Nativo 6.0 | Decisão |
| --- | --- | --- | --- |
| Linguagem | JavaScript síncrono: expressão ou corpo com `return`; compatibilidade separada DAE | Filtro declarativo serializado em JSON, inicializado como `Filter` | Conservar ambos; não converter JS arbitrário |
| Persistência | `flags.sc-conditional-ae.condition`; fallback em flags DAE | `system.conditions` e condições por alteração | Não apagar nem sobrepor campos de outro motor |
| Condição global falsa | Supressão ou desabilitação gerenciada, conforme opção | Supressão global calculada | Há sobreposição, mas não equivalência completa |
| Desabilitação manual | SC preserva efeitos desabilitados pelo usuário e usa marcador de propriedade | `disabled` é estado do documento; filtro não equivale à opção SC | Preservar a política e o marcador SC |
| Dados | Documentos `actor`, `item`, `origin`, `originActor`, `game`, helpers, `rollData` | Dados de substituição/rolagem e caminhos de filtros | Adapter precisa resolver documentos e dados separadamente |
| Condições por alteração | Não há gate SC individual equivalente | Disponível nativamente | Não executar macros/fórmulas ignorando esse gate |
| Contexto de ataque/rolagem | Gate SC global, sem contexto equivalente ao motor de regras | Regras podem filtrar o teste atual | Usar nativo para regras; não prometer paridade em 5.3 |
| Iluminação | `lightLevel`, token selecionado, refresh após iluminação | Não há equivalência automática ao serviço SC de classificação de luz | Manter serviço SC e testar no core alvo |
| Macros `on/off` | Serviço SC e rastreamento de transições | Os filtros, por si, não substituem esse serviço | Manter com política explícita de transição |
| Fórmula aleatória | Pode rolar na ativação e persistir resultado, com chat e rerrolagem | Fórmulas e bônus/regras possuem outro momento de avaliação | Evitar dupla rolagem e mudança de significado |

Exemplo de sobreposição: `return actor.system.attributes.hp.value > 0;` pode ser representado por um filtro cujo objeto é `{ "k": "attributes.hp.value", "o": "gt", "v": 0 }`, serializado no campo nativo. O caminho é relativo aos dados usados na avaliação, não o caminho JS do documento.

Já a condição SC de comparar HP atual com metade do HP máximo, consultar uma coleção de itens, resolver documentos ou testar `lightLevel` não deve ser convertida por substituição textual. Mesmo quando existe uma representação nativa conveniente, como um status preparado, o momento de avaliação pode diferir.

Fontes: [modelo comum dos efeitos][native-model], [efeito base][native-base], [documento ActiveEffect][native-effect], [filtros][native-filter], [regras aplicadas][native-rules], [preparação do ator][native-actor].

## Inventário de incompatibilidades e riscos

Prioridades: **P0** impede declarar suporte; **P1** necessário para suporte completo; **P2** melhoria, diagnóstico ou validação complementar. Riscos não são apresentados como falhas reproduzidas em Foundry.

### Aplicação, origem e ciclo de vida

| ID | Estado / prioridade | Evidência e consequência | Adaptação necessária |
| --- | --- | --- | --- |
| APP-01 | Confirmado / P0 | `scripts/hooks/EffectApplicationHooks.js` substitui `_applyEffectToActor` inteiro. No 6.0 esse método delega a `_prepareEffectData`; o SC não a chama. Efeitos válidos passam pela implementação SC mesmo sem condição SC. | Adapter 6.0 deve preservar a preparação nativa e acrescentar apenas a política SC. O impacto é maior que efeitos condicionais. |
| APP-02 | Confirmado / P0 | O patch ignora `activity.getAppliedEffectChanges()`: perde duração derivada da atividade e ajustes de expiração. | Consumir dados preparados pelo sistema. Validar atividade sem duração explícita no AE e reuso de AE expirado. |
| APP-03 | Confirmado / P0 | O nativo reaplica com `start: getEffectStart()` e `duration.expired: false`. SC espalha o retorno de `getEffectStart()` na raiz e não limpa `expired`. | Separar 5.3 `getInitialDuration()` de 6.0 `start`; não tratar os retornos como formatos equivalentes. |
| APP-04 | Confirmado / P0 | `_prepareEffectData` chama `forApplication()` para `replacement: origin/target`; SC cria a cópia sem essa etapa. Valor baseado no conjurador/alvo perde a substituição prevista. | Preservar `forApplication`, inclusive após decidir criar duplicata em vez de atualizar. |
| APP-05 | Confirmado / P1 | Nativo consulta item/atividade com `{ scaled: true }` e lê nível de `chatMessage.system.level`; SC consulta atividade sem essa opção e usa `system.spellLevel`. | Usar contexto preparado nativamente; conferir nível, scaling e valores de upcast. |
| APP-06 | Confirmado / P0 | Nativo identifica reaplicação por `_stats.compendiumSource`/`duplicateSource` e grava `system.origin` com atividade, mensagem e perfil. SC usa igualdade de `origin` e assinatura nome/key/mode. | Preservar provenance nativa e definir identidade SC explícita por fonte/perfil/alvo. Não unificar efeitos apenas por origem de concentração. |
| CTX-01 | Confirmado / P1 | `ActiveEffectContextBuilder` só resolve origem Actor, Item ou ActiveEffect por `effect.origin`/`fromUuidSync`. Em 6.0 `origin` é derivado e pode apontar para Activity ou RegionBehavior. `getItem`, `getOriginActor` e recuperação de flags podem retornar `null`. | Resolver `system.origin`, documentos Activity e origem de região, mantendo os aliases públicos SC. |
| CTX-02 | Confirmado / P1 | Perfis de atividade suportam UUID externo e `getEffect()` possivelmente assíncrono. `EffectApplicationHooks.#resolveLinkedItemEffect` e inferência em `ActiveEffectTransferMetadataService` presumem relação com o item e resolução síncrona. | Resolver perfis com `await getEffect()`/`getApplicableEffects()`, preservando ID do perfil; considerar compêndio não carregado. Não há uso direto de `applicableEffects` no SC, mas a suposição equivalente existe nos helpers. |
| TRF-01 | Risco fundamentado / P1 | `ActiveEffectTransferHooks.#buildMirrorEffectData` copia tudo e altera apenas `origin` legado. `prepareBaseData` do 6.0 prioriza `system.origin`. Fonte do espelho pode permanecer a origem anterior. | Escrever origem pela API do adapter, preservar vínculo SC do espelho e verificar remoção, desequipar e exclusão da fonte. |
| TRF-02 | Risco fundamentado / P1 | O 6.0 força `transfer` e `disabled` preparados para falso em efeitos associados a atividades. Classificação SC de transferência e sincronização de disabled dependem desses valores. | Distinguir fonte de atividade de efeito aplicado e de efeito transferido; não disputar estado que o sistema controla. |

Fonte da comparação do chat: [implementação 5.3.3][old-chat] e [implementação 6.0.0][native-chat]. Os problemas APP-01 a APP-06 são caminhos concretamente omitidos; não dependem de supor a remoção de uma API.

### Alterações, fórmulas e macros

| ID | Estado / prioridade | Evidência e consequência | Adaptação necessária |
| --- | --- | --- | --- |
| DATA-01 | Dependência de shim confirmada / P0 | O modelo 6.0 usa `system.changes`, com `_id`, `type`, `conditions`, `replacement`. O SC já lê/escreve `system.changes` em alguns caminhos, porém rerrolagem, reset e outros caminhos ainda gravam `{ changes }`. | Centralizar leitura e gravação. Não afirmar que toda fórmula já quebra: aliases do Foundry podem aceitar o legado. Eliminar dependência não verificada e preservar todos os campos modernos. |
| DATA-02 | Risco estrutural / P1 | `flags.sc-conditional-ae.formulaChanges` e entradas de chat referenciam índices. A ficha 6.0 edita, duplica e remove por `_id`. Reordenação/exclusão pode associar fórmula ou mensagem antiga a outra alteração. | Chavear fórmulas por ID estável em 6.0, migrar índices com validação, invalidar ações de chat cujo ID desapareceu. Índices já eram frágeis em 5.3; não é uma regressão exclusiva de 6.0. |
| DATA-03 | Confirmado / P1 | `getChangeSignature()` considera apenas `key` e `mode`; ignora `type` moderno, condições e identidade. Dois efeitos com mesmo nome/key e tipos distintos podem parecer iguais. | Assinatura por adapter, priorizando identidade de origem/perfil antes de heurísticas. |
| MAC-01 | Confirmado em Node / P0 | `ActiveEffectMacroChangeService.normalizeChanges()` só processa `source.changes` e escreve `mode = CUSTOM`. Um payload `system.changes` não é normalizado. O hook de criação também escreve só `{ changes }`. | Ler formato moderno e emitir tipo custom suportado pelo core/DAE; não presumir equivalência textual sem teste. |
| MAC-02 | Confirmado / P1 | A execução de macros filtra por key; não avalia `change.conditions`. Uma condição nativa falsa na linha de macro não impede o serviço SC de executá-la quando o efeito está ativo. | Definir avaliação por alteração para macro; estado `on/off` por ID quando necessário. Não disparar macro a cada preparação ou rolagem. |
| FOR-01 | Confirmado / P1 | `isFormulaEligibleChange()` exclui custom/macros, mas não separa tipos nativos de regra, valores estruturados e substituição. Fórmulas SC escrevem resultado como string persistida e não consultam condição individual. | Lista de capacidades elegíveis; preservar semântica de bônus por rolagem e `replacement`; decidir quando uma fórmula individual fica disponível. |
| FOR-02 | Risco fundamentado / P1 | Ativação/rerrolagem depende de `effect.active`, `disabled` e avaliação SC, sem modelo de resultado por alteração/rolagem. Uma regra válida só em um ataque não equivale a ativar/desativar o AE. | Separar disponibilidade global, aplicabilidade da alteração e evento de rolagem. Testar efeito misto: bônus estático + regra + macro. |

Leitura de `effect.changes` não deve ser classificada isoladamente como remoção confirmada: o próprio sistema 6.0 ainda usa esse acesso em trechos de apresentação. O problema é a inconsistência dos caminhos de escrita e a perda de semântica, não simplesmente a presença da palavra `changes`.

### Condições e interface

| ID | Estado / prioridade | Evidência e consequência | Adaptação necessária |
| --- | --- | --- | --- |
| CON-01 | Diferença semântica / P1 | `ActiveEffectConditionService.hasCondition/evaluate` só conhece flags SC/DAE. Um efeito apenas com filtro nativo retorna “sem condição SC / disponível” pela API, mesmo quando o nativo o suprime. | Manter significado atual da API para compatibilidade e acrescentar diagnóstico composto, sem reutilizar `evaluate` silenciosamente como avaliação total. |
| CON-02 | Risco fundamentado / P0 | SC usa cache pós-preparação e resets; 6.0 pré-coleta status, avalia condição global em fases e coleta regras. Há potencial de estado anterior, ciclos e decisão divergente em condições dependentes de dados alterados pelo próprio efeito. | Preservar `isSuppressed` nativo e `shouldApplyChange`; validar estabilidade e propagação dos status. Não resolver tudo com reset a cada rolagem. |
| CON-03 | Limitação já existente / P2 | Há exemplos com `game.combat`, mas os hooks SC não incluem `updateCombat`/`updateWorldTime`. Expor um dado não garante refresh ao mudar só esse dado. | Tratar como dívida anterior, com estratégia de invalidação por dependência; testar mudança de combate sem update no ator. |
| UI-01 | Confirmado / P0 | A nova ficha mostra valores em spans e abre `EffectChangeConfig`. `FormulaColumnRenderer` procura inputs `changes.N.value`; o novo diálogo usa campos `key/type/value` sem esse caminho e não está no hook SC de ficha de AE. A coluna/editor não é inserida nesse fluxo. | Adapter de ficha 6.0 com integração no diálogo por `changeId`; manter editor 5.3. |
| UI-02 | Risco fundamentado / P1 | `ConditionalActiveEffectSheetMixin._onRender` não aguarda o super assíncrono. O registrador força o default e detecta mixin por aba `condition`, apesar de existir marcador próprio. | Aguardar lifecycle e usar marcador SC. Preservar ficha nativa e extensões externas. Não há colisão confirmada: a condição nativa global fica em Details, não em uma aba `condition` na tag auditada. |
| UI-03 | Compatibilidade parcial / P1 | A lista nativa ainda tem `data-effect-id` e `.effect-name`, mas mudou estrutura/controles. Seletores SC exigem combinações específicas de `.effects-list`, `.item.effect`, `.activity-row` e controles. | Verificar badges e botões em ator/item e Tidy. Não declarar quebra total do seletor apenas por mudanças gerais de HTML. |
| UI-04 | Diferença de significado / P1 | Badge SC descreve sua condição global; não explica condições nativas por alteração nem regras que aguardam rolagem. | Mostrar estados distintos: SC, supressão nativa e dependência de contexto; evitar badge global “aplicado” significar que todas as alterações foram aplicadas. |

Fontes: [ficha de AE][native-sheet], [diálogo de alteração][native-change-sheet], [template das alterações][native-changes-template].

### Dados do sistema, integrações e suporte

| ID | Estado / prioridade | Evidência e consequência | Adaptação necessária |
| --- | --- | --- | --- |
| SYS-01 | Confirmado / P0 | O manifest SC declara Foundry mínimo 13 e D&D mínimo 4, sem seleção por versão; 6.0 exige Foundry 14.367. | Validar pares sistema/core na inicialização. Manter mínimo que permita 5.3/13; não aumentar globalmente para 14 se esse ambiente continua suportado. |
| SYS-02 | Confirmado para referências diretas / P1 | 6.0 move bônus para `system.rolls`, movimento para `movement.speeds`, altera AC e outros dados. Shims de keys de AE não reescrevem JavaScript SC nem todo acesso a rolldata. Logs SC ainda leem `system.bonuses.*`. | Inventariar referências de conteúdo e prover helpers estáveis; distinguir alteração de key de alteração de script. Não fazer replace global de código de usuário. |
| EXT-01 | Não certificado / P1 | Integração DAE depende de flags enable/disable, evento `dae.modifySpecials`, `mode`, macro e stackable. O fallback de Aura Effects pode usar modelo diferente do nativo D&D. | Matriz com versões concretas de DAE/Aura/Tidy/libWrapper; inspecionar schema real de cada tipo. Não atribuir incompatibilidade à versão externa sem teste. |
| EXT-02 | Novo caminho / P1 | Regiões 6.0 aplicam efeitos fora do componente de chat, gravam origem de behavior e removem ao sair. O patch SC de aplicação pelo chat não participa. Flags copiados via `toObject` podem sobreviver, mas contexto e duplicação exigem definição. | Adapter de origem atende regiões; preservar ownership da região e sua remoção. Não transferir automaticamente a regra de duplicação do chat para áreas persistentes. |
| EXT-03 | Não certificado / P1 | `TokenLightingService` usa APIs do canvas do core, não o filtro D&D. Trocar sistema também exige atualizar o core para 14.367. | Revalidar luz global/local, darkness, paredes, token sintético, múltiplos tokens e canvas ausente; não reescrever por suposta remoção no D&D. |

Mudanças relevantes de conteúdo: `system.bonuses.{mwak,msak,rwak,rsak}.{attack,damage}` passa a `system.rolls.{attack,damage}.{tipo}.bonus`; bônus de habilidade/perícia/ferramenta mudam para campos de roll; movimento passa a `system.attributes.movement.speeds.*`; AC usa coleções `ac.calcs`/`ac.formulas`. São caminhos a verificar nos efeitos e scripts, não uma licença para reescrever todos automaticamente.

Mudanças de senses/ranges já possuíam shims em 5.3.3 e não devem ser contabilizadas integralmente como perda nova. A configuração de senses e a escala percentual de bloodied também merecem atenção se um script de usuário consultar `CONFIG.DND5E`, embora o módulo não faça essas consultas diretamente. [Notas oficiais][release] e [shims do documento][native-effect].

## O que não está perdido ou substituído

- JavaScript síncrono e condições existentes em flags SC podem continuar funcionando; o sistema não interpreta esses scripts nativamente.
- Os wrappers de `isSuppressed` e `applyChange` possuem alvos no 6.0. A composição atual usa OR na supressão e preserva o retorno original quando não bloqueia a alteração.
- O serviço SC de luz, helpers, fallback DAE, gerenciamento de disabled, políticas de duplicação, macros e chat de fórmulas continuam sendo funcionalidades próprias, sujeitas às adaptações listadas.
- O registrador já descobre tipos de AE dinamicamente. O novo tipo `condition` não é, sozinho, evidência de quebra.
- `getAssociatedActivity()` continua existindo. O problema é ignorar escala, perfis externos e a preparação nativa, não sua remoção.
- O chat próprio SC publica `content` HTML e flags próprias. Não há evidência de que a mudança de chat cards nativos, isoladamente, remova esse caminho; exige teste de apresentação/interação.
- Ganhos do 6.0 que podemos aproveitar: filtros declarativos com editor, regras contextuais, origens estruturadas e perfis externos. Não precisam ser reimplementados dentro do motor JS.

## Arquitetura proposta para suporte simultâneo

Selecionar uma implementação por `game.system.version` e, dentro dela, por capacidades do core. D&D 5.3.3 pode rodar no Foundry 13 ou 14; portanto “D&D 5 = formato velho de core” é uma premissa insuficiente.

Estrutura sugerida, ainda não criada:

```text
scripts/adapters/dnd5e/
  Dnd5eAdapterRegistry.js
  Dnd5e53Adapter.js
  Dnd5e60Adapter.js
scripts/adapters/foundry/
  ActiveEffectCapabilities.js
```

| Contrato proposto | Responsabilidade |
| --- | --- |
| `getChanges(effect)` / `buildChangesUpdate(effect, changes)` | Ler fonte serializável, preservar `_id/type/conditions/replacement/phase/priority`; emitir formato correto |
| `getChangeIdentity(effect, change, index)` | Identidade estável e ponte para flags antigas indexadas |
| `resolveApplicationContext(message, effect, target)` | Origem, item/atividade escalados, perfil externo, proveniência, duração, substituição |
| `resolveSourceContext(effect)` | `origin`, `item`, `originActor` públicos SC com origens legadas, atividade, compêndio e região |
| `installApplicationIntegration()` | Preservar preparação nativa e aplicar política update/duplicate apenas nos pontos necessários |
| `installConditionIntegration()` | Gate SC adicional, sem eliminar supressão/condições nativas, com comportamento consistente com libWrapper e fallback |
| `getAvailability(effect, context)` | Diagnóstico composto com motivo e contexto; não confundir regra aguardando roll com efeito desabilitado |
| `isChangeEligibleForFormula(change)` | Restringir integração SC aos tipos e semânticas suportados |
| `extendEffectSheet()` / `extendChangeEditor()` | Ficha 5.3 e diálogo 6.0, sem seletores de um layout no outro |

Para alterações comuns, a regra conceitual é: documento elegível **E** condição SC satisfeita **E** autorização nativa para aquela alteração. Essa fórmula não autoriza chamar filtros de rolagem com contexto vazio: regras permanecem sob a avaliação contextual do sistema.

Evitar transformar `system.conditions` em flag SC, converter scripts automaticamente ou simular todas as rule changes do 6.0 no 5.3. A paridade prometida deve ser das funcionalidades SC. Conteúdo exclusivo de 6.0 precisa de indicação explícita de indisponibilidade em 5.3.

### Sequência de implementação

1. **P0 — Contratos e suporte:** registry/capabilities, validação do par sistema/core, testes de payloads de ambas as versões. Não elevar o manifest globalmente para Foundry 14.
2. **P0 — Aplicação:** substituir a cópia do pipeline por integração que preserve preparação nativa; corrigir reapplication/start/expired, origem, scaling e replacement; provar update e duplicate.
3. **P0 — Dados e edição:** centralizar mudanças, normalizar macros, integrar editor 6.0 e manter edição 5.3. Preservar campos que o SC não entende.
4. **P0/P1 — Semântica:** validar supressão, status, cache, regras e transições. Definir condições individuais de macro/fórmula e impedir execuções duplicadas.
5. **P1 — Identidade e conteúdo:** migrar flags de fórmula para IDs, resolver origem/compêndios, revisar espelhos e diagnosticar referências antigas de scripts.
6. **P1 — Integrações e aceite:** Foundry real nas combinações abaixo, versões externas registradas e revisão final de manifest/capacidades.

Migrações de flags SC devem ser idempotentes, versionadas e conservar a informação necessária para os ambientes suportados. Não guardar uma segunda cópia autoritativa e divergente de `system.conditions`. Migração de índices deve verificar correspondência antes de vincular fórmula a ID, especialmente após exclusão/duplicação.

## Matriz de validação e critérios de aceite

| Ambiente | Situação atual | Aceite necessário |
| --- | --- | --- |
| Foundry 13.347+ compatível / D&D 5.3.3 | Base declarada pelo manifest oficial; testes SC isolados passam | Regressão completa SC em mundo 5.3 |
| Foundry 14 compatível / D&D 5.3.3 | Manifest oficial declara verified 14, sem garantir todo build futuro | Testar formato moderno do core com sistema 5.3 |
| Foundry 14.367+ compatível / D&D 6.0.0 | Código auditado; sem sessão executada | Cobrir P0 e P1 antes de declarar suporte |
| Cada ambiente com/sem libWrapper | Dois mecanismos SC existentes | Mesma supressão e aplicação, sem patches duplicados |
| DAE, Aura Effects e Tidy | Versões externas não certificadas nesta análise | Registrar versões, executar individualmente e na combinação usada pelo projeto |

Casos de aceite:

1. Condição SC verdadeira/falsa/erro; suppress e disable; efeito desabilitado manualmente nunca reativado pelo SC; ausência de writes redundantes e de disputa entre clientes.
2. Filtro nativo global verdadeiro/falso com SC verdadeiro/falso; efeito apenas nativo; efeito sem alterações mas com status; imunidade e supressão de item/magia preservadas.
3. Duas alterações com condições diferentes; regras aplicadas somente ao tipo de roll correto; bônus estático no mesmo efeito continua correto. Não alterar `disabled` por filtro de ataque.
4. Macro liga/desliga uma vez, inclusive quando a condição muda; condição da própria macro falsa; DAE ativo não executa a mesma macro duas vezes.
5. Fórmula na criação/ativação/reaplicação/rerrolagem; exclusão e duplicação de alteração; mensagem de chat antiga; campos nativos preservados após salvar.
6. Aplicação do chat a um e vários alvos; update/duplicate; concentração; efeito expirado; duração herdada; upcast; replacement de origem versus alvo; efeito referenciado em compêndio não carregado.
7. Item transferido, duas cópias do item, espelho, equipar/desequipar/atunar, remoção da origem, efeito associado a atividade e enchantment.
8. Região aplica/remove sem apagar efeitos de outra região; contexto de conjurador disponível; copiar flags não copia estado gerenciado indevidamente.
9. Abrir, salvar e reabrir ficha/diálogo em 5.3 e 6.0; editar condição nativa e SC independentemente; badges e rerrolagem em ator/item/Tidy.
10. Luz bright/dim/dark/global, paredes, movimento, canvas fechado e token sintético; múltiplos tokens do mesmo ator e clientes em cenas distintas.
11. Condição com HP máximo/AC derivados estabiliza; nenhum loop de preparação e nenhuma multiplicação de bônus; mudança apenas em combate reavalia se declarada suportada.

## Verificações realizadas

- `node --test tests/*.test.mjs`: **7 arquivos de teste passaram, 0 falhas**. São testes isolados com stubs; não simulam todo o runtime do sistema 6.0.
- Executado `Filter` do checkout oficial 6.0 com utilitários mínimos: filtro `attributes.hp.value > 0` retornou verdadeiro para 1 e falso para 0.
- Executado `ActiveEffectMacroChangeService.normalizeChanges`: payload legado `changes` foi normalizado para CUSTOM; payload moderno `system.changes` foi ignorado. Confirma MAC-01 independentemente da interface.
- Comparação direta do template 6.0 demonstrou ausência dos inputs `changes.N.value` exigidos pelo renderer SC e presença de editor separado por ID.
- Nenhuma alteração de runtime, migração de mundo ou elevação de compatibilidade foi realizada. Esta branch contém o diagnóstico para orientar a implementação e sua validação.

## Fontes oficiais fixadas

Os links abaixo são permalinks da versão auditada; as referências aos arquivos `scripts/` são do commit SC indicado no início.

[native-model]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/data/abstract/active-effect-data-model.mjs
[native-base]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/data/active-effect/base.mjs
[native-effect]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/documents/active-effect.mjs
[native-filter]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/filter.mjs
[native-rules]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/documents/applied-rules.mjs
[native-actor]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/documents/actor/actor.mjs
[native-chat]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/applications/components/effect-application.mjs
[old-chat]: https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/module/applications/components/effect-application.mjs
[native-sheet]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/applications/active-effect/active-effect-sheet.mjs
[native-change-sheet]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/applications/active-effect/effect-change-config.mjs
[native-changes-template]: https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/templates/effects/effect-changes.hbs
[release]: https://github.com/foundryvtt/dnd5e/releases/tag/release-6.0.0

- [Manifest oficial 6.0.0](https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/system.json).
- [Manifest oficial 5.3.3](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/system.json).
- [Perfis de efeitos em atividades](https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/data/activity/fields/applied-effect-field.mjs).
- [Aplicação por regiões](https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/data/region-behavior/apply-active-effect.mjs).
- [Tipos de alterações e regras](https://github.com/foundryvtt/dnd5e/blob/2e913fbf578f09a4b2a37e18b314772061a9160f/module/config.mjs).
