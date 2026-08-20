import { render } from 'solid-js/web'
import { RadialSpike } from './RadialSpike'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

render(() => <RadialSpike />, root)
