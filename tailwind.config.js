/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 1px)',
  			sm: 'calc(var(--radius) - 2px)',
  			card: '4px',
  			btn: '3px',
  			input: '3px',
  			table: '4px'
  		},
  		maxWidth: {
  			shell: '1440px',
  			content: '1240px',
  			prose: '68ch'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
  			popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
  			primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
  			secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
  			muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
  			accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
  			destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			/* Institutional palette — deep government navy/blue over paper white.
  			   Kept under the existing `brand.*` keys so every screen inherits it. */
  			brand: {
  				blue: '#0B4A8F',
  				dark: '#072F5F',
  				deep: '#051F3E',
  				accent: '#1B6EC2',
  				sky: '#4A90D9',
  				light: '#EDF3FA',
  				bg: '#F4F6FA',
  				paper: '#FBFCFE',
  				gold: '#B98A1E',
  				goldlight: '#E4C35D',
  				goldpale: '#FBF3DE',
  				amber: '#7A5A12',
  				yellow: '#B98A1E',
  				green: '#1F7A4C',
  				danger: '#B3202C',
  				gray: '#54637A',
  				ink: '#12263F',
  				border: '#D6DEE8',
  				rule: '#C3CEDC'
  			},
  			/* Philippine flag — reserved for official rules and seals only */
  			flag: {
  				blue: '#0038A8',
  				red: '#CE1126',
  				yellow: '#FCD116'
  			}
  		},
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)'],
  			display: ['var(--font-display)'],
  			stat: ['var(--font-stat)'],
  			mono: ['var(--font-mono)']
  		},
  		letterSpacing: {
  			gov: '0.22em',
  			seal: '0.32em'
  		},
  		keyframes: {
  			'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
  			'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } }
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
