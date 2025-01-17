import {
  Status,
  SummaryFormatter,
  IFormatterOptions,
  formatterHelpers,
} from '@cucumber/cucumber'
import * as messages from '@cucumber/messages'
import * as CliTable3 from 'cli-table3'
import { cross, tick } from 'figures'
import { EOL as n } from 'os'
import dedent from 'ts-dedent'

import { makeTheme, ThemeItem, ThemeStyles } from './theme'

const { formatLocation, GherkinDocumentParser, PickleParser } = formatterHelpers
const {
  getGherkinExampleRuleMap,
  getGherkinScenarioMap,
  getGherkinStepMap,
} = GherkinDocumentParser
const { getPickleStepMap } = PickleParser

const marks = {
  [Status.AMBIGUOUS]: cross,
  [Status.FAILED]: cross,
  [Status.PASSED]: tick,
  [Status.PENDING]: '?',
  [Status.SKIPPED]: '-',
  [Status.UNDEFINED]: '?',
  [Status.UNKNOWN]: '?',
}

const defaultThemeStyles: ThemeStyles = {
  [ThemeItem.DataTable]: [],
  [ThemeItem.DataTableBorder]: ['gray'],
  [ThemeItem.DataTableContent]: ['gray', 'italic'],
  [ThemeItem.DocStringContent]: ['gray', 'italic'],
  [ThemeItem.DocStringDelimiter]: ['gray'],
  [ThemeItem.FeatureDescription]: ['gray'],
  [ThemeItem.FeatureKeyword]: ['blueBright', 'bold'],
  [ThemeItem.FeatureName]: ['blueBright', 'underline'],
  [ThemeItem.Location]: ['dim'],
  [ThemeItem.RuleKeyword]: ['blueBright', 'bold'],
  [ThemeItem.RuleName]: ['blueBright', 'underline'],
  [ThemeItem.ScenarioKeyword]: ['cyan', 'bold'],
  [ThemeItem.ScenarioName]: ['cyan', 'underline'],
  [ThemeItem.StepKeyword]: ['cyan'],
  [ThemeItem.StepMessage]: [],
  [ThemeItem.StepStatus]: [],
  [ThemeItem.StepText]: [],
  [ThemeItem.Tag]: ['cyan'],
}

const themeItemIndentations: { [key in ThemeItem]: number } = {
  [ThemeItem.DataTable]: 6,
  [ThemeItem.DataTableBorder]: 0,
  [ThemeItem.DataTableContent]: 0,
  [ThemeItem.DocStringContent]: 6,
  [ThemeItem.DocStringDelimiter]: 6,
  [ThemeItem.FeatureDescription]: 2,
  [ThemeItem.FeatureKeyword]: 0,
  [ThemeItem.FeatureName]: 0,
  [ThemeItem.Location]: 0,
  [ThemeItem.RuleKeyword]: 2,
  [ThemeItem.RuleName]: 0,
  [ThemeItem.ScenarioKeyword]: 2,
  [ThemeItem.ScenarioName]: 0,
  [ThemeItem.StepKeyword]: 4,
  [ThemeItem.StepMessage]: 6,
  [ThemeItem.StepStatus]: 4,
  [ThemeItem.StepText]: 0,
  [ThemeItem.Tag]: 0,
}

export default class PrettyFormatter extends SummaryFormatter {
  private uri?: string
  private lastRuleId?: string
  private indentOffset = 0
  private logItem: (item: ThemeItem, ...text: string[]) => void
  private styleItem: (
    indent: number,
    item: ThemeItem,
    ...text: string[]
  ) => string
  private tableLayout: CliTable3.TableConstructorOptions

  constructor(options: IFormatterOptions) {
    super(options)
    const theme = makeTheme(
      !!options.parsedArgvOptions.colorsEnabled
        ? options.parsedArgvOptions.theme || defaultThemeStyles
        : {}
    )

    this.styleItem = (indent: number, item: ThemeItem, ...text: string[]) => {
      if (indent > 0 && this.indentOffset > 0)
        indent = indent + this.indentOffset
      return theme.indentStyleText(indent, item, ...text)
    }

    this.logItem = (item: ThemeItem, ...text: string[]) =>
      this.log(this.styleItem(themeItemIndentations[item], item, ...text))

    this.parseEnvelope = this.parseEnvelope.bind(this)

    const tableFrameChar = theme.indentStyleText(
      0,
      ThemeItem.DataTableBorder,
      '│'
    )

    this.tableLayout = {
      chars: {
        left: tableFrameChar,
        middle: tableFrameChar,
        right: tableFrameChar,
        top: '',
        'top-left': '',
        'top-mid': '',
        'top-right': '',
        mid: '',
        'left-mid': '',
        'mid-mid': '',
        'right-mid': '',
        bottom: '',
        'bottom-left': '',
        'bottom-mid': '',
        'bottom-right': '',
      },
      style: {
        head: [],
        border: [],
      },
    }

    options.eventBroadcaster.on('envelope', this.parseEnvelope)
  }

  private parseEnvelope(envelope: messages.Envelope) {
    if (envelope.testCaseStarted)
      this.onTestCaseStarted(envelope.testCaseStarted)
    if (envelope.testStepStarted)
      this.onTestStepStarted(envelope.testStepStarted)
    if (envelope.testStepFinished)
      this.onTestStepFinished(envelope.testStepFinished)
    if (envelope.testCaseFinished)
      this.onTestCaseFinished(envelope.testCaseFinished)
  }

  private onTestCaseStarted(testCaseStarted: messages.TestCaseStarted) {
    const {
      gherkinDocument,
      pickle,
    } = this.eventDataCollector.getTestCaseAttempt(testCaseStarted.id || '')
    const { feature } = gherkinDocument
    if (this.uri !== gherkinDocument.uri && feature) {
      this.indentOffset = 0
      this.uri = gherkinDocument.uri || ''
      this.lastRuleId = undefined
      this.renderFeatureHead(feature)
    }

    const gherkinExampleRuleMap = getGherkinExampleRuleMap(gherkinDocument)
    if (!pickle.astNodeIds) throw new Error('Pickle AST nodes missing')
    const rule = gherkinExampleRuleMap[pickle.astNodeIds[0]]
    if (rule && rule.id !== this.lastRuleId) {
      this.indentOffset = 0
      this.renderRule(rule)
      this.lastRuleId = rule.id
      this.indentOffset = 2
    }

    this.renderScenarioHead(gherkinDocument, pickle)
  }

  private onTestStepStarted(testStepStarted: messages.TestStepStarted) {
    const {
      gherkinDocument,
      pickle,
      testCase,
    } = this.eventDataCollector.getTestCaseAttempt(
      testStepStarted.testCaseStartedId || ''
    )

    const pickleStepMap = getPickleStepMap(pickle)
    const gherkinStepMap = getGherkinStepMap(gherkinDocument)
    const testStep = (testCase.testSteps || []).find(
      (item) => item.id === testStepStarted.testStepId
    )

    if (testStep && testStep.pickleStepId) {
      const pickleStep = pickleStepMap[testStep.pickleStepId]
      const astNodeId = pickleStep.astNodeIds[0]
      const gherkinStep = gherkinStepMap[astNodeId]
      this.logItem(ThemeItem.StepKeyword, gherkinStep.keyword)
      this.log(' ')
      this.logItem(ThemeItem.StepText, pickleStep.text)
      this.newline()

      if (gherkinStep.docString) {
        this.logItem(
          ThemeItem.DocStringDelimiter,
          gherkinStep.docString.delimiter
        )
        this.newline()
        this.logItem(ThemeItem.DocStringContent, gherkinStep.docString.content)
        this.newline()
        this.logItem(
          ThemeItem.DocStringDelimiter,
          gherkinStep.docString.delimiter
        )
        this.newline()
      }

      if (gherkinStep.dataTable) {
        const datatable = new CliTable3(this.tableLayout)
        datatable.push(
          ...gherkinStep.dataTable.rows.map((row: messages.TableRow) =>
            (row.cells || []).map((cell) =>
              this.styleItem(0, ThemeItem.DataTableContent, cell.value || '')
            )
          )
        )
        this.logItem(ThemeItem.DataTable, datatable.toString())
        this.newline()
      }
    }
  }

  private onTestStepFinished(testStepFinished: messages.TestStepFinished) {
    const { message, status } = testStepFinished.testStepResult || {}

    if (status && status !== Status.PASSED) {
      this.logItem(
        ThemeItem.StepStatus,
        this.colorFns.forStatus(status)(
          `${marks[status]} ${Status[status].toLowerCase()}`
        )
      )
      this.newline()

      if (message) {
        this.logItem(ThemeItem.StepMessage, message)
        this.newline()
      }
    }
  }

  private onTestCaseFinished(_testCaseFinished: messages.TestCaseFinished) {
    this.newline()
  }

  private renderTags(indent: number, tags: readonly { name: string }[]) {
    const tagStrings = tags.reduce<string[]>(
      (tags, tag) => (tag.name ? [...tags, tag.name] : tags),
      []
    )
    if (tagStrings.length > 0) {
      const firstTag = tagStrings.shift() as string
      this.log(this.styleItem(indent, ThemeItem.Tag, firstTag))
      tagStrings.forEach((tag) => {
        this.log(' ')
        this.logItem(ThemeItem.Tag, tag)
      })
      this.newline()
    }
  }

  private renderFeatureHead(feature: messages.Feature) {
    this.renderTags(0, feature.tags || [])
    this.logItem(ThemeItem.FeatureKeyword, feature.keyword || '[feature]', ':')
    this.log(' ')
    this.logItem(ThemeItem.FeatureName, feature.name || '')
    if (feature.location) {
      this.log(' ')
      this.renderLocation(feature.location?.line || -1)
    }
    this.newline()

    if (feature.description) {
      this.newline()
      this.logItem(
        ThemeItem.FeatureDescription,
        dedent(feature.description.trim())
      )
      this.newline()
    }
    this.newline()
  }

  private renderRule(rule: messages.Rule) {
    this.logItem(ThemeItem.RuleKeyword, rule.keyword, ':')
    this.log(' ')
    this.logItem(ThemeItem.RuleName, rule.name || '')
    this.newline()
    this.newline()
  }

  private renderScenarioHead(
    gherkinDocument: messages.GherkinDocument,
    pickle: messages.Pickle
  ) {
    this.renderTags(2, pickle.tags || [])
    const gherkinScenarioMap = getGherkinScenarioMap(gherkinDocument)
    if (!pickle.astNodeIds) throw new Error('Pickle AST nodes missing')

    const scenario: messages.Scenario = gherkinScenarioMap[pickle.astNodeIds[0]]
    this.logItem(ThemeItem.ScenarioKeyword, scenario.keyword || '???', ':')
    this.log(' ')
    this.logItem(ThemeItem.ScenarioName, pickle.name || '')
    if (gherkinScenarioMap[pickle.astNodeIds[0]]) {
      this.log(' ')
      this.renderLocation(scenario.location?.line || -1)
    }
    this.newline()
  }

  private renderLocation(line: number) {
    this.logItem(
      ThemeItem.Location,
      '# ',
      formatLocation({ uri: this.uri || '', line }, process.cwd())
    )
  }

  private newline() {
    this.log(n)
  }
}
