import 'server-only'
import { LanguageModelV1 } from '@ai-sdk/provider';

import {
  createAI,
  createStreamableUI,
  getMutableAIState,
  getAIState,
  streamUI,
  createStreamableValue
} from 'ai/rsc'
import { mistral } from '@ai-sdk/mistral'

import {
  spinner,
  BotMessage,
  SystemMessage
} from '@/components/stocks'

import { z } from 'zod'
import {
  formatNumber,
  runAsyncFnWithoutBlocking,
  sleep,
  nanoid
} from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Chat, Message } from '@/lib/types'
import { auth } from '@/auth'

async function performAction(action: string, details: any) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()

  const performingAction = createStreamableUI(
    <div className="inline-flex items-start gap-1 md:items-center">
      {spinner}
      <p className="mb-2">
        Performing action: {action}...
      </p>
    </div>
  )

  const systemMessage = createStreamableUI(null)

  runAsyncFnWithoutBlocking(async () => {
    await sleep(1000)

    performingAction.update(
      <div className="inline-flex items-start gap-1 md:items-center">
        {spinner}
        <p className="mb-2">
          Performing action: {action}... working on it...
        </p>
      </div>
    )

    await sleep(1000)

    performingAction.done(
      <div>
        <p className="mb-2">
          Action {action} completed successfully.
        </p>
      </div>
    )

    systemMessage.done(
      <SystemMessage>
        The action {action} has been completed successfully.
      </SystemMessage>
    )

    aiState.done({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: nanoid(),
          role: 'system',
          content: `[User performed action: ${action}. Details: ${JSON.stringify(details)}]`
        }
      ]
    })
  })

  return {
    actionUI: performingAction.value,
    newMessage: {
      id: nanoid(),
      display: systemMessage.value
    }
  }
}

async function submitUserMessage(content: string) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content
      }
    ]
  })

  let textStream: undefined | ReturnType<typeof createStreamableValue<string>>
  let textNode: undefined | React.ReactNode
  const model = mistral('ft:open-mistral-7b:1b8e4d68:20240615:677d3e2e') as LanguageModelV1;

  const result = await streamUI({
    model: model,
    initial: <SpinnerMessage />,
    system: `\
    You are SyDeTre, an AI companion that helps others recognize their symptoms, provide possible diseases
    they may be facing and what treatment they should get. You are not a replacement for a doctor
    but will still provide helpful insights to patients. Do not mention "based on the information" or similar in your answer.
    Respond to the queries in detail.
    Given this information answer the query below: `,
    messages: [
      ...aiState.get().messages.map((message: any) => ({
        role: message.role,
        content: message.content,
        name: message.name
      }))
    ],
    text: ({ content, done, delta }) => {
      if (!textStream) {
        textStream = createStreamableValue('')
        textNode = <BotMessage content={textStream.value} />
      }

      if (done) {
        textStream.done()
        aiState.done({
          ...aiState.get(),
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: 'assistant',
              content
            }
          ]
        })
      } else {
        textStream.update(delta)
      }

      return textNode
    }
  })

  return {
    id: nanoid(),
    display: result.value
  }
}

export type AIState = {
  chatId: string
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
}[]

export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage,
    performAction
  },
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
  onGetUIState: async () => {
    'use server'
  
    const session = await auth();
  
    if (session && session.user) {
      const aiState = getAIState() as Chat; // Asserting type directly
  
      if (aiState) {
        const uiState = getUIStateFromAIState(aiState); // Now passes the type check
        return uiState;
      }
    } else {
      return;
    }
  },
  
  onSetAIState: async ({ state }) => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const { chatId, messages } = state

      const createdAt = new Date()
      const userId = session.user.id as string
      const path = `/chat/${chatId}`

      const firstMessageContent = messages[0].content as string
      const title = firstMessageContent.substring(0, 100)

      const chat: Chat = {
        id: chatId,
        title,
        userId,
        createdAt,
        messages,
        path
      }

      await saveChat(chat)
    } else {
      return
    }
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'user' ? (
          <UserMessage>{message.content as string}</UserMessage>
        ) : message.role === 'assistant' &&
          typeof message.content === 'string' ? (
          <BotMessage content={message.content} />
        ) : null
    }))
}
