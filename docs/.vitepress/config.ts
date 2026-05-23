import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Deep Agents 源码深度解析',
  description: '深入解析 LangChain Deep Agents 框架的核心机制与实现原理',
  base: '/deepagents-source-code-analysis/',
  lang: 'zh-CN',

  head: [
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'Deep Agents 源码深度解析' }],
    ['meta', { name: 'og:description', content: '深入解析 LangChain Deep Agents 框架的核心机制与实现原理' }],
  ],

  themeConfig: {
    logo: {
      src: '/logo.svg',
      width: 32,
      height: 32
    },

    nav: [
      { text: '指南', link: '/guide/overview', activeMatch: '/guide/' },
      { text: '架构', link: '/architecture/overview', activeMatch: '/architecture/' },
      { text: '核心', link: '/core/create-deep-agent', activeMatch: '/core/' },
      { text: '进阶', link: '/advanced/custom-middleware', activeMatch: '/advanced/' },
      { text: 'GitHub', link: 'https://github.com/langchain-ai/deepagents' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '概览', link: '/guide/overview' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '源码结构', link: '/guide/structure' },
            { text: '调试指南', link: '/guide/debugging' }
          ]
        }
      ],
      '/architecture/': [
        {
          text: '架构',
          items: [
            { text: '整体架构', link: '/architecture/overview' },
            { text: '中间件系统', link: '/architecture/middleware-system' },
            { text: '后端系统', link: '/architecture/backend-system' },
            { text: '子代理系统', link: '/architecture/subagent-system' },
            { text: '配置系统', link: '/architecture/profile-system' }
          ]
        }
      ],
      '/core/': [
        {
          text: '核心入口',
          items: [
            { text: 'create_deep_agent', link: '/core/create-deep-agent' },
            { text: '模型解析', link: '/core/models' },
            { text: '工具系统', link: '/core/tools' }
          ]
        },
        {
          text: '中间件',
          items: [
            { text: 'FilesystemMiddleware', link: '/core/filesystem-middleware' },
            { text: 'SubAgentMiddleware', link: '/core/subagent-middleware' },
            { text: 'AsyncSubAgentMiddleware', link: '/core/async-subagent' },
            { text: 'MemoryMiddleware', link: '/core/memory-middleware' },
            { text: 'SkillsMiddleware', link: '/core/skills-middleware' },
            { text: 'SummarizationMiddleware', link: '/core/summarization-middleware' },
            { text: 'HumanInTheLoop', link: '/core/hitl' },
            { text: 'ToolExclusion', link: '/core/tool-exclusion' }
          ]
        },
        {
          text: '后端',
          items: [
            { text: 'BackendProtocol', link: '/core/backend-protocol' },
            { text: 'StateBackend', link: '/core/state-backend' },
            { text: 'FilesystemBackend', link: '/core/filesystem-backend' },
            { text: 'SandboxBackend', link: '/core/sandbox-backend' },
            { text: 'CompositeBackend', link: '/core/composite-backend' }
          ]
        }
      ],
      '/advanced/': [
        {
          text: '进阶',
          items: [
            { text: '自定义中间件', link: '/advanced/custom-middleware' },
            { text: '自定义后端', link: '/advanced/custom-backend' },
            { text: '自定义子代理', link: '/advanced/custom-subagent' },
            { text: '最佳实践', link: '/advanced/best-practices' },
            { text: '性能优化', link: '/advanced/performance' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/langchain-ai/deepagents' }
    ],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换'
            }
          }
        }
      }
    },

    outline: {
      label: '页面导航',
      level: [2, 3]
    },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    },

    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  },

  markdown: {
    lineNumbers: true
  }
})