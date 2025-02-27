const path = require('path')
const Telegraf = require('telegraf')
const Composer = require('telegraf/composer')
const session = require('telegraf/session')
const rateLimit = require('telegraf-ratelimit')
const I18n = require('telegraf-i18n')
const {
  db
} = require('./database')
const {
  handleError,
  handleStart,
  handleClub,
  handleSticker,
  handleDeleteSticker,
  handleRestoreSticker,
  handlePacks,
  handleSelectPack,
  handleHidePack,
  handleRestorePack,
  handleCopyPack,
  handleLanguage,
  handleEmoji,
  handleStickerUpade,
  handlePublish,
  handleInlineQuery
} = require('./handlers')
const scenes = require('./scenes')
const {
  updateUser,
  stats
} = require('./utils')

global.startDate = new Date()

// init bot
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    webhookReply: false
  },
  handlerTimeout: 1
})

bot.on(['channel_post', 'edited_channel_post', 'poll'], () => {})

bot.use((ctx, next) => {
  next().catch((error) => {
    return handleError(error, ctx)
  })
  return true
})

// I18n settings
const { match } = I18n
const i18n = new I18n({
  directory: path.resolve(__dirname, 'locales'),
  defaultLanguage: 'en',
  defaultLanguageOnMissing: true
})

// I18n middleware
bot.use(i18n)

// rate limit
bot.use(rateLimit({
  window: 1000,
  limit: 10,
  onLimitExceeded: (ctx) => ctx.reply(ctx.i18n.t('ratelimit'))
}))

const limitPublicPack = Composer.optional((ctx) => {
  return ctx.session?.userInfo?.stickerSet?.passcode === 'public'
}, rateLimit({
  window: 1000 * 60,
  limit: 1,
  onLimitExceeded: (ctx) => ctx.reply(ctx.i18n.t('ratelimit'))
}))

bot.use(stats)

bot.use((ctx, next) => {
  if (ctx.update.my_chat_member) return false
  else return next()
})

// bot config
bot.context.config = require('./config.json')

// db connect
bot.context.db = db

// use session
bot.use(
  session({
    getSessionKey: (ctx) => {
      if ((ctx.from && ctx.chat && ctx.chat.id === ctx.from.id) || (!ctx.chat && ctx.from)) {
        return `user:${ctx.from.id}`
      } else if (ctx.from && ctx.chat) {
        return `${ctx.from.id}:${ctx.chat.id}`
      }
      return null
    }
  })
)

// response time logger
bot.use(async (ctx, next) => {
  // const ms = new Date()
  if (ctx.inlineQuery) {
    await updateUser(ctx)
    ctx.state.answerIQ = []
  }
  if (ctx.callbackQuery) ctx.state.answerCbQuery = []
  return next(ctx).then(() => {
    if (ctx.inlineQuery) return ctx.answerInlineQuery(...ctx.state.answerIQ)
    if (ctx.callbackQuery) return ctx.answerCbQuery(...ctx.state.answerCbQuery)
  })
})

bot.use(Composer.privateChat(async (ctx, next) => {
  await updateUser(ctx)
  await next(ctx)
  await ctx.session.userInfo.save().catch(() => {})
}))

bot.command('json', ({ replyWithHTML, message }) =>
  replyWithHTML('<code>' + JSON.stringify(message, null, 2) + '</code>')
)

// scene
bot.use(scenes)

bot.use(require('./handlers/admin'))

// main commands
bot.start((ctx, next) => {
  if (ctx.startPayload === 'inline_pack') {
    ctx.state.type = 'inline'
    return handlePacks(ctx)
  }
  return next()
})
bot.hears(['/packs', match('cmd.start.btn.packs')], ctx => {
  ctx.state.type = 'common'
  return handlePacks(ctx)
})
bot.hears(['/inline', match('cmd.start.btn.inline')], ctx => {
  ctx.state.type = 'inline'
  return handlePacks(ctx)
})
bot.hears(['/anim', match('cmd.start.btn.anim')], ctx => {
  ctx.state.type = 'animated'
  return handlePacks(ctx)
})

bot.hears(['/video', match('cmd.start.btn.video')], ctx => {
  ctx.state.type = 'video'
  return handlePacks(ctx)
})

bot.start((ctx, next) => {
  if (ctx.startPayload.match(/s_(.*)/)) return handleSelectPack(ctx)
  return next()
})

bot.hears(['/new', match('cmd.start.btn.new')], (ctx) => ctx.scene.enter('сhoosePackType'))
bot.action(/new_pack/, (ctx) => ctx.scene.enter('сhoosePackType'))
bot.hears(['/club', '/start club', match('cmd.start.btn.club')], handleClub)
bot.hears(/addstickers\/(.*)/, handleCopyPack)
bot.command('public', handleSelectPack)
bot.command('emoji', handleEmoji)
bot.command('copy', (ctx) => ctx.replyWithHTML(ctx.i18n.t('cmd.copy')))
bot.command('restore', (ctx) => ctx.replyWithHTML(ctx.i18n.t('cmd.restore')))
bot.command('original', (ctx) => ctx.scene.enter('originalSticker'))
bot.command('lang', handleLanguage)
bot.hears(/(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g, handleStickerUpade)

bot.use(handlePublish)
bot.use(handleInlineQuery)

// sticker detect
bot.on(['sticker', 'document', 'photo', 'video'], limitPublicPack, handleSticker)

// callback
bot.action(/(set_pack):(.*)/, handlePacks)
bot.action(/(hide_pack):(.*)/, handleHidePack)
bot.action(/(delete_sticker):(.*)/, limitPublicPack, handleDeleteSticker)
bot.action(/(restore_sticker):(.*)/, limitPublicPack, handleRestoreSticker)
bot.action(/set_language:(.*)/, handleLanguage)

// forward from sticker bot
bot.on('text', (ctx, next) => {
  if (ctx.message.forward_from && ctx.message.forward_from.id === 429000) return handleRestorePack(ctx)
  else return next()
})

// club
bot.action(/(club):(.*)/, handleClub)

// any message
bot.on('message', handleStart)

// start bot
db.connection.once('open', async () => {
  console.log('Connected to MongoDB')
  if (process.env.BOT_DOMAIN) {
    bot.launch({
      webhook: {
        domain: process.env.BOT_DOMAIN,
        hookPath: `/fStikBot:${process.env.BOT_TOKEN}`,
        port: process.env.WEBHOOK_PORT || 2500
      }
    }).then(() => {
      console.log('bot start webhook')
    })
  } else {
    bot.launch().then(() => {
      console.log('bot start polling')
    })
  }
  require('./utils/messaging')
  require('./utils/optimize-db')
})
