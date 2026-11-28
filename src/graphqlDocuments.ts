/**
 * 所有 GraphQL 文档集中在此，便于审计与复用。
 * 读取方向按 IM 语义：最新一批用 last，向上翻页用 before。
 */

export const Q_VIEWER = /* GraphQL */ `
  query Me {
    viewer {
      login
      avatarUrl
    }
  }
`

export const Q_ROOM = /* GraphQL */ `
  query Room($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      discussionCategories(first: 10) {
        nodes {
          id
          name
        }
      }
      discussions(first: 50) {
        nodes {
          id
          number
          title
          comments(last: 1) {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`

export const Q_MESSAGES = /* GraphQL */ `
  query Messages($id: ID!, $before: String) {
    node(id: $id) {
      ... on Discussion {
        comments(last: 30, before: $before) {
          pageInfo {
            startCursor
            hasPreviousPage
          }
          nodes {
            id
            body
            bodyHTML
            createdAt
            author {
              login
              avatarUrl
            }
          }
        }
      }
    }
  }
`

export const M_SEND = /* GraphQL */ `
  mutation Send($discussionId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
      comment {
        id
        body
        bodyHTML
        createdAt
        author {
          login
          avatarUrl
        }
      }
    }
  }
`

export const M_ENSURE_ROOM = /* GraphQL */ `
  mutation EnsureRoom($repo: ID!, $cat: ID!, $title: String!) {
    createDiscussion(input: { repositoryId: $repo, categoryId: $cat, title: $title, body: "IM channel" }) {
      discussion {
        id
        number
      }
    }
  }
`
