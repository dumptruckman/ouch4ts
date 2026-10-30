import type ts from "typescript";

type CallGraph = ReadonlyMap<ts.SignatureDeclaration, ReadonlySet<ts.SignatureDeclaration>>;
type CallVisit = {
  node: ts.SignatureDeclaration;
  index: number;
  earliestReachableIndex: number;
  active: boolean;
  targets: Iterator<ts.SignatureDeclaration, undefined>;
};

/** Find cyclic components once with iterative Tarjan traversal, including long call chains. */
export function recursiveCallNodes(graph: CallGraph) {
  return new CallCycleFinder(graph).find();
}

class CallCycleFinder {
  private readonly visits = new Map<ts.SignatureDeclaration, CallVisit>();
  private readonly pending: CallVisit[] = [];
  private readonly componentStack: CallVisit[] = [];
  private readonly recursive = new Set<ts.SignatureDeclaration>();

  constructor(private readonly graph: CallGraph) {}

  find() {
    for (const node of this.graph.keys()) this.visitUnseen(node);
    return this.recursive;
  }

  private visitUnseen(node: ts.SignatureDeclaration) {
    if (this.visits.has(node)) return;
    this.enter(node);
    while (this.pending.length) this.advance(this.pending.at(-1)!);
  }

  private enter(node: ts.SignatureDeclaration) {
    const visit: CallVisit = {
      node, index: this.visits.size, earliestReachableIndex: this.visits.size, active: true,
      targets: (this.graph.get(node) ?? []).values(),
    };
    this.visits.set(node, visit);
    this.pending.push(visit);
    this.componentStack.push(visit);
  }

  private advance(visit: CallVisit) {
    const target = visit.targets.next();
    if (target.done) this.finishVisit(visit);
    else this.visitTarget(visit, target.value);
  }

  private visitTarget(caller: CallVisit, target: ts.SignatureDeclaration) {
    const visit = this.visits.get(target);
    if (!visit) return this.enter(target);
    if (visit.active) caller.earliestReachableIndex = Math.min(caller.earliestReachableIndex, visit.index);
  }

  private finishVisit(visit: CallVisit) {
    this.pending.pop();
    const caller = this.pending.at(-1);
    if (caller) caller.earliestReachableIndex = Math.min(caller.earliestReachableIndex, visit.earliestReachableIndex);
    if (visit.earliestReachableIndex === visit.index) this.recordComponent(visit);
  }

  private recordComponent(root: CallVisit) {
    const component = this.takeComponent(root);
    if (component.length > 1 || this.graph.get(root.node)?.has(root.node)) {
      component.forEach(node => this.recursive.add(node));
    }
  }

  private takeComponent(root: CallVisit) {
    const component: ts.SignatureDeclaration[] = [];
    let visit: CallVisit;
    do {
      visit = this.componentStack.pop()!;
      visit.active = false;
      component.push(visit.node);
    } while (visit !== root);
    return component;
  }
}
