// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'opendatahub-lifecycle-badge': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { lifecycle?: string }, HTMLElement>
    }
  }
}
